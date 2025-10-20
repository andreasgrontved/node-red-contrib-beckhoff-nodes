module.exports = function (RED) {
    const Modbus = require('jsmodbus');
    const net = require('net');

    // Card address sizes and function codes
    const CARD_INFO = {
        // Digital Inputs (FC2 - Read Discrete Inputs)
        'KL1804': { size: 4, fc: 'readDiscreteInputs', channels: 4, direction: 'input' },
        'KL1808': { size: 8, fc: 'readDiscreteInputs', channels: 8, direction: 'input' },
        
        // Digital Outputs (FC5 - Write Single Coil, FC1 - Read Coils for reading back)
        'KL2404': { size: 4, fc: 'writeSingleCoil', readFc: 'readCoils', channels: 4, direction: 'output' },
        'KL2408': { size: 8, fc: 'writeSingleCoil', readFc: 'readCoils', channels: 8, direction: 'output' },
        
        // Analog Inputs (FC4)
        'KL3204': { size: 8, fc: 'readInputRegisters', channels: 4, direction: 'input' },
        'KL3208': { size: 16, fc: 'readInputRegisters', channels: 8, direction: 'input' },
        'KL3464': { size: 8, fc: 'readInputRegisters', channels: 4, direction: 'input' },
        'KL3468': { size: 16, fc: 'readInputRegisters', channels: 8, direction: 'input' }
    };

    // State meanings for KL3208
    const STATE_MESSAGES = {
        0: "OK - Sensor connected",
        65: "No sensor connected",
        66: "Unconfigured"
    };

    function convertKL1808Data(rawArray) {
        const expectedSize = rawArray.length;
        if (!Array.isArray(rawArray) || (expectedSize !== 4 && expectedSize !== 8)) {
            return { error: `Expected 4 or 8 element array from Modbus, got ${rawArray?.length}` };
        }

        const channels = [];
        const result = { channels: channels };
        
        for (let ch = 0; ch < expectedSize; ch++) {
            const rawValue = rawArray[ch];
            const channelData = {
                channel: ch + 1,
                value: rawValue ? true : false,
                rawValue: rawValue
            };
            channels.push(channelData);
            result['ch' + (ch + 1)] = channelData;
        }
        
        return result;
    }

    function convertKL3208Data(rawArray, channelConfigs) {
        const expectedSize = rawArray.length;
        const numChannels = expectedSize / 2;
        
        if (!Array.isArray(rawArray) || (expectedSize !== 8 && expectedSize !== 16)) {
            return { error: `Expected 8 or 16 element array from Modbus, got ${rawArray?.length}` };
        }

        const channels = [];
        const result = { channels: channels };
        
        for (let ch = 0; ch < numChannels; ch++) {
            // FIXED: Data comes first (even indices), then state (odd indices)
            const dataIdx = ch * 2;
            const stateIdx = ch * 2 + 1;
            
            const state = rawArray[stateIdx];
            let rawValue = rawArray[dataIdx];
            
            const sensorType = channelConfigs?.[ch] || 'pt1000';
            
            if (rawValue > 32767) {
                rawValue = rawValue - 65536;
            }
            
            let celsius, fahrenheit, unit, resistance;
            
            if (sensorType.startsWith('res_')) {
                resistance = rawValue / 100;
                celsius = null;
                fahrenheit = null;
                unit = 'Ω';
            } else {
                celsius = rawValue / 100;
                fahrenheit = (celsius * 9/5) + 32;
                unit = '°C / °F';
                resistance = null;
            }
            
            const stateMessage = STATE_MESSAGES[state] || `Unknown state: ${state}`;
            
            const channelData = {
                channel: ch + 1,
                sensorType,
                state,
                stateMessage,
                rawValue,
                ok: state === 0
            };
            
            if (resistance !== null) {
                channelData.resistance = Math.round(resistance * 100) / 100;
                channelData.unit = unit;
            } else {
                channelData.celsius = Math.round(celsius * 100) / 100;
                channelData.fahrenheit = Math.round(fahrenheit * 100) / 100;
                channelData.unit = unit;
            }
            
            channels.push(channelData);
            result['ch' + (ch + 1)] = channelData;
        }
        
        return result;
    }

    function convertKL3468Data(rawArray, channelConfigs) {
        const expectedSize = rawArray.length;
        const numChannels = expectedSize / 2;
        
        if (!Array.isArray(rawArray) || (expectedSize !== 8 && expectedSize !== 16)) {
            return { error: `Expected 8 or 16 element array from Modbus, got ${rawArray?.length}` };
        }

        const channels = [];
        const result = { channels: channels };
        
        for (let ch = 0; ch < numChannels; ch++) {
            // FIXED: Data comes first (even indices), then state (odd indices)
            const dataIdx = ch * 2;
            const stateIdx = ch * 2 + 1;
            
            const state = rawArray[stateIdx];
            let rawValue = rawArray[dataIdx];
            
            const config = channelConfigs?.[ch] || { range: '0-10', manufacturer: 'generic' };
            const range = config.range || '0-10';
            const manufacturer = config.manufacturer || 'generic';
            
            if (rawValue > 32767) {
                rawValue = rawValue - 65536;
            }
            
            const voltage = (rawValue / 32767) * 10;
            
            let minV, maxV, adaptationRaw;
            switch(range) {
                case '0.5-10':
                    minV = 0.5;
                    maxV = 10;
                    adaptationRaw = 1648;
                    break;
                case '2-10':
                    minV = 2;
                    maxV = 10;
                    adaptationRaw = null;
                    break;
                default:
                    minV = 0;
                    maxV = 10;
                    adaptationRaw = null;
            }
            
            let percentage;
            if (voltage < minV) {
                percentage = 0;
            } else if (voltage > maxV) {
                percentage = 100;
            } else {
                percentage = ((voltage - minV) / (maxV - minV)) * 100;
            }
            
            const channelData = {
                channel: ch + 1,
                state,
                rawValue,
                voltage: Math.round(voltage * 100) / 100,
                percentage: Math.round(percentage * 10) / 10,
                range,
                manufacturer
            };
            
            if (manufacturer === 'belimo' && range === '0.5-10') {
                const adaptationMode = Math.abs(rawValue - adaptationRaw) < 10;
                channelData.adaptationMode = adaptationMode;
            }
            
            channels.push(channelData);
            result['ch' + (ch + 1)] = channelData;
        }
        
        return result;
    }

    function makeMatcher(filter, fallbackExact) {
        if (filter && typeof filter === "string" && filter.length) {
            if (filter.startsWith("/") && filter.endsWith("/")) {
                try { 
                    const re = new RegExp(filter.slice(1, -1)); 
                    return t => typeof t === "string" && re.test(t); 
                } catch { 
                    return () => false; 
                }
            }
            if (filter.includes("*")) {
                const esc = s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
                const re = new RegExp("^" + esc(filter).replace(/\*/g, ".*") + "$");
                return t => typeof t === "string" && re.test(t);
            }
            return t => t === filter;
        }
        return t => t === fallbackExact;
    }

    function BK9100Node(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        let cards = config.cards;
        if (typeof cards === "string") {
            try { cards = JSON.parse(cards); } catch { cards = []; }
        }
        if (!Array.isArray(cards)) cards = [];

        // Calculate address offsets for each card
        const routes = [];
        let digitalInputAddress = 0;   // For FC2 (digital inputs)
        let digitalOutputAddress = 0;  // For FC5 (digital outputs)
        let analogAddress = 0;          // For FC4 (analog inputs)
        
        cards.forEach(c => {
            const type = (c.type || "").toUpperCase();
            const cardInfo = CARD_INFO[type];
            
            if (cardInfo) {
                let startAddress;
                
                // Separate address spaces for different I/O types
                if (cardInfo.fc === 'readCoils') {
                    startAddress = digitalInputAddress;
                    digitalInputAddress += cardInfo.size;
                } else if (cardInfo.fc === 'writeSingleCoil') {
                    startAddress = digitalOutputAddress;
                    digitalOutputAddress += cardInfo.size;
                } else {
                    startAddress = analogAddress;
                    analogAddress += cardInfo.size;
                }
                
                routes.push({
                    type: type,
                    label: c.label || "",
                    filter: c.filter || "",
                    config: c.config || null,
                    pollRate: c.pollRate || null,
                    pollOutputs: c.pollOutputs || false,
                    readOnWrite: c.readOnWrite !== false,
                    startAddress: startAddress,
                    size: cardInfo.size,
                    channels: cardInfo.channels,
                    functionCode: cardInfo.fc,
                    readFunctionCode: cardInfo.readFc || null,
                    direction: cardInfo.direction,
                    match: makeMatcher(c.filter || "", c.type || ""),
                    lastPoll: 0
                });
            }
        });

        // Modbus connection settings
        const modbusHost = config.host || '192.168.1.100';
        const modbusPort = parseInt(config.port) || 502;
        const unitId = parseInt(config.unitId) || 1;
        const pollInterval = parseInt(config.pollInterval) || 1000;

        let socket = null;
        let client = null;
        let pollTimer = null;
        let reconnectTimer = null;

        node.log(`Configured ${routes.length} cards`);
        routes.forEach((r, i) => {
            const rate = r.pollRate || pollInterval;
            node.log(`  Card ${i+1} (${r.type}): ${r.direction}, ${rate}ms`);
        });

        node.status({ fill: "grey", shape: "ring", text: "connecting..." });

        // Connect to Modbus TCP
        function connect() {
            try {
                socket = new net.Socket();
                client = new Modbus.client.TCP(socket, unitId);

                socket.connect({
                    host: modbusHost,
                    port: modbusPort
                });

                socket.on('connect', function() {
                    node.status({ fill: "green", shape: "dot", text: `connected to ${modbusHost}` });
                    if (reconnectTimer) {
                        clearTimeout(reconnectTimer);
                        reconnectTimer = null;
                    }
                    startPolling();
                });

                socket.on('error', function(err) {
                    node.status({ fill: "red", shape: "ring", text: "error: " + err.message });
                    node.error("Modbus error: " + err.message);
                });

                socket.on('close', function() {
                    node.status({ fill: "yellow", shape: "ring", text: "disconnected" });
                    stopPolling();
                    if (!reconnectTimer) {
                        reconnectTimer = setTimeout(connect, 5000);
                    }
                });
            } catch (err) {
                node.status({ fill: "red", shape: "ring", text: "connection failed" });
                node.error("Failed to connect: " + err.message);
                if (!reconnectTimer) {
                    reconnectTimer = setTimeout(connect, 5000);
                }
            }
        }

        // Poll all input cards (and optionally output cards if pollOutputs enabled)
        async function pollCards() {
            if (!client || !socket || socket.destroyed) {
                return;
            }

            const now = Date.now();
            const outs = new Array(routes.length).fill(null);

            for (let i = 0; i < routes.length; i++) {
                const route = routes[i];
                
                // Skip output cards unless pollOutputs is enabled
                if (route.direction === 'output' && !route.pollOutputs) {
                    continue;
                }
                
                if (!route.size) {
                    continue;
                }

                const cardPollRate = route.pollRate || pollInterval;
                if (now - route.lastPoll < cardPollRate) {
                    continue;
                }

                try {
                    let response;
                    let data;
                    
                    if (route.direction === 'output') {
                        // Read output coils (FC1)
                        response = await client.readCoils(
                            route.startAddress, 
                            route.size
                        );
                        data = response.response._body._valuesAsArray;
                    } else if (route.functionCode === 'readDiscreteInputs') {
                        // FC2 for digital inputs
                        response = await client.readDiscreteInputs(
                            route.startAddress, 
                            route.size
                        );
                        data = response.response._body._valuesAsArray;
                    } else {
                        // FC4 for analog inputs
                        response = await client.readInputRegisters(
                            route.startAddress, 
                            route.size
                        );
                        data = response.response._body._valuesAsArray;
                    }
                    
                    let payload;
                    const cardType = route.type;
                    
                    if (cardType === 'KL1804' || cardType === 'KL1808' || cardType === 'KL2404' || cardType === 'KL2408') {
                        payload = convertKL1808Data(data);
                        if (payload.error) {
                            node.warn(`${cardType} conversion error: ${payload.error}`);
                        }
                    } else if (cardType === 'KL3204' || cardType === 'KL3208') {
                        payload = convertKL3208Data(data, route.config?.channels);
                        if (payload.error) {
                            node.warn(`${cardType} conversion error: ${payload.error}`);
                        }
                    } else if (cardType === 'KL3464' || cardType === 'KL3468') {
                        payload = convertKL3468Data(data, route.config?.channels);
                        if (payload.error) {
                            node.warn(`${cardType} conversion error: ${payload.error}`);
                        }
                    } else {
                        node.warn(`Unknown card type: ${cardType} - outputting raw data`);
                        payload = data;
                    }
                    
                    if (payload.channels && Array.isArray(payload.channels)) {
                        const channelMessages = payload.channels.map(ch => {
                            const baseTopic = route.filter || route.label || route.type;
                            const msg = {
                                topic: `${baseTopic}/ch${ch.channel}`,
                                payload: ch,
                                cardType: route.type,
                                cardLabel: route.label
                            };
                            return msg;
                        });
                        
                        channelMessages.forEach(msg => {
                            outs[i] = msg;
                            node.send(outs);
                            outs[i] = null;
                        });
                    } else {
                        outs[i] = {
                            topic: route.filter || route.label || route.type,
                            payload: payload
                        };
                        node.send(outs);
                        outs[i] = null;
                    }
                    
                    route.lastPoll = now;
                    
                } catch (err) {
                    node.warn(`Error reading ${route.type} at address ${route.startAddress}: ${err.message}`);
                    outs[i] = {
                        topic: route.type,
                        payload: { error: err.message }
                    };
                }
            }
        }

        function startPolling() {
            if (pollTimer) clearInterval(pollTimer);
            
            let fastestRate = pollInterval;
            routes.forEach(r => {
                // Include output cards with pollOutputs enabled
                if (r.direction === 'input' || (r.direction === 'output' && r.pollOutputs)) {
                    const cardRate = r.pollRate || pollInterval;
                    if (cardRate < fastestRate) {
                        fastestRate = cardRate;
                    }
                }
            });
            
            fastestRate = Math.max(50, fastestRate);
            
            pollTimer = setInterval(pollCards, fastestRate);
            pollCards();
        }

        function stopPolling() {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
        }

        // Handle incoming messages to write outputs
        node.on('input', async function(msg) {
            if (!client || !socket || socket.destroyed) {
                node.warn("Cannot write output - not connected to Modbus");
                return;
            }

            try {
                // Support multiple message formats
                let targetCard = null;
                let targetChannel = null;
                let value = null;

                // Format 1: Topic-based (e.g., msg.topic = "KL2408/ch3" or "DO00/ch1")
                if (msg.topic && typeof msg.topic === 'string') {
                    const parts = msg.topic.split('/');
                    if (parts.length === 2 && parts[1].toLowerCase().startsWith('ch')) {
                        const cardIdentifier = parts[0];
                        targetChannel = parseInt(parts[1].substring(2));
                        value = msg.payload;

                        // Find card by filter first (custom topic), then label, then type (case-insensitive)
                        const cardIdUpper = cardIdentifier.toUpperCase();
                        targetCard = routes.find(r => 
                            r.direction === 'output' && 
                            (r.filter.toUpperCase() === cardIdUpper || 
                             r.label.toUpperCase() === cardIdUpper || 
                             r.type.toUpperCase() === cardIdUpper)
                        );
                    }
                }

                // Format 2: Payload object
                if (!targetCard && typeof msg.payload === 'object' && msg.payload !== null) {
                    const cardIdentifier = msg.payload.card;
                    targetChannel = msg.payload.channel;
                    value = msg.payload.value;

                    if (cardIdentifier !== undefined && targetChannel !== undefined) {
                        // Find by filter, label, type, or index (case-insensitive)
                        if (typeof cardIdentifier === 'number') {
                            targetCard = routes.filter(r => r.direction === 'output')[cardIdentifier];
                        } else {
                            const cardIdUpper = String(cardIdentifier).toUpperCase();
                            targetCard = routes.find(r => 
                                r.direction === 'output' && 
                                (r.filter.toUpperCase() === cardIdUpper || 
                                 r.label.toUpperCase() === cardIdUpper || 
                                 r.type.toUpperCase() === cardIdUpper)
                            );
                        }
                    }
                }

                // Validate
                if (!targetCard) {
                    node.warn("Could not find output card. Use topic like 'KL2408/ch3' or 'DO00/ch1' (if filter set) or payload {card:'label', channel:3, value:true}");
                    return;
                }

                if (targetChannel < 1 || targetChannel > targetCard.channels) {
                    node.warn(`Invalid channel ${targetChannel} for ${targetCard.type} (valid: 1-${targetCard.channels})`);
                    return;
                }

                // Convert value to 0 or 1 for Modbus (accepts boolean, number, or string)
                let coilValue;
                if (typeof value === 'boolean') {
                    coilValue = value ? 1 : 0;
                } else if (typeof value === 'number') {
                    coilValue = value ? 1 : 0;
                } else if (typeof value === 'string') {
                    const lower = value.toLowerCase();
                    coilValue = (lower === 'true' || lower === '1' || lower === 'on') ? 1 : 0;
                } else {
                    coilValue = value ? 1 : 0;
                }

                // Calculate actual Modbus address
                const modbusAddress = targetCard.startAddress + (targetChannel - 1);

                // Write to Modbus (writeSingleCoil expects 0 or 1)
                await client.writeSingleCoil(modbusAddress, coilValue);
                
                const cardName = targetCard.filter || targetCard.label || targetCard.type;
                node.log(`Wrote ${coilValue} to ${cardName} channel ${targetChannel} (address ${modbusAddress})`);

                // Read back the coil state if readOnWrite is enabled
                if (targetCard.readOnWrite) {
                    try {
                        const readback = await client.readCoils(modbusAddress, 1);
                        const actualValue = readback.response._body._valuesAsArray[0];
                        
                        // Find output index for this card
                        const outputIndex = routes.indexOf(targetCard);
                        if (outputIndex >= 0) {
                            const outs = new Array(routes.length).fill(null);
                            const baseTopic = targetCard.filter || targetCard.type;
                            outs[outputIndex] = {
                                topic: `${baseTopic}/ch${targetChannel}`,
                                payload: {
                                    channel: targetChannel,
                                    value: actualValue ? true : false,
                                    rawValue: actualValue
                                },
                                cardType: targetCard.type,
                                cardLabel: targetCard.label
                            };
                            node.send(outs);
                        }
                    } catch (readErr) {
                        node.warn(`Could not read back output state: ${readErr.message}`);
                    }
                }

            } catch (err) {
                node.error("Error writing output: " + err.message);
                node.error(err.stack);
            }
        });

        // Start Modbus connection
        connect();

        // Cleanup on node close
        node.on('close', function(done) {
            stopPolling();
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            if (socket) {
                socket.removeAllListeners();
                socket.end();
                socket.destroy();
            }
            done();
        });
    }

    RED.nodes.registerType("BK9100", BK9100Node);
};