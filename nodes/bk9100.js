module.exports = function (RED) {
    const Modbus = require('jsmodbus');
    const net = require('net');

    // Card address sizes and function codes
    const CARD_INFO = {
        'KL1808': { size: 8, fc: 'readCoils' },           // FC2 - Read Input Status (digital)
        'KL3208': { size: 16, fc: 'readInputRegisters' }, // FC4 - Read Input Registers (analog)
        'KL3468': { size: 16, fc: 'readInputRegisters' }  // FC4 - Read Input Registers (analog)
    };

    // State meanings for KL3208
    const STATE_MESSAGES = {
        0: "OK - Sensor connected",
        65: "No sensor connected",
        66: "Unconfigured"
    };

    function convertKL1808Data(rawArray) {
        if (!Array.isArray(rawArray) || rawArray.length !== 8) {
            return { error: "Expected 8-element array from Modbus" };
        }

        const channels = [];
        
        for (let ch = 0; ch < 8; ch++) {
            channels.push({
                channel: ch + 1,
                value: rawArray[ch]
            });
        }
        
        return { channels };
    }

    function convertKL3208Data(rawArray, channelConfigs) {
        if (!Array.isArray(rawArray) || rawArray.length !== 16) {
            return { error: "Expected 16-element array from Modbus" };
        }

        const channels = [];
        
        for (let ch = 0; ch < 8; ch++) {
            const stateIdx = ch * 2;
            const dataIdx = ch * 2 + 1;
            
            const state = rawArray[stateIdx];
            let rawValue = rawArray[dataIdx];
            
            const sensorType = channelConfigs?.[ch] || 'pt1000';
            
            // Convert signed 16-bit integer
            if (rawValue > 32767) {
                rawValue = rawValue - 65536;
            }
            
            // Raw value is in hundredths of a degree (divide by 100)
            let celsius, fahrenheit, unit, resistance;
            
            if (sensorType.startsWith('res_')) {
                // Resistance measurement (in hundredths of ohms)
                resistance = rawValue / 100;
                celsius = null;
                fahrenheit = null;
                unit = 'Ω';
            } else {
                // Temperature measurement (in hundredths of degrees)
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
        }
        
        return { channels };
    }

    function convertKL3468Data(rawArray, channelConfigs) {
        if (!Array.isArray(rawArray) || rawArray.length !== 16) {
            return { error: "Expected 16-element array from Modbus" };
        }

        const channels = [];
        
        for (let ch = 0; ch < 8; ch++) {
            const stateIdx = ch * 2;
            const dataIdx = ch * 2 + 1;
            
            const state = rawArray[stateIdx];
            let rawValue = rawArray[dataIdx];
            
            const config = channelConfigs?.[ch] || { range: '0-10', manufacturer: 'generic' };
            const range = config.range || '0-10';
            const manufacturer = config.manufacturer || 'generic';
            
            // Convert signed 16-bit integer
            if (rawValue > 32767) {
                rawValue = rawValue - 65536;
            }
            
            // Convert raw value to voltage (32767 = 10V)
            const voltage = (rawValue / 32767) * 10;
            
            // Determine range parameters
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
                default: // '0-10'
                    minV = 0;
                    maxV = 10;
                    adaptationRaw = null;
            }
            
            // Calculate percentage (0-100%)
            let percentage;
            if (voltage < minV) {
                percentage = 0;
            } else if (voltage > maxV) {
                percentage = 100;
            } else {
                percentage = ((voltage - minV) / (maxV - minV)) * 100;
            }
            
            // Build channel data
            const channelData = {
                channel: ch + 1,
                state,
                rawValue,
                voltage: Math.round(voltage * 100) / 100,
                percentage: Math.round(percentage * 10) / 10,
                range,
                manufacturer
            };
            
            // Only include adaptationMode for Belimo with 0.5-10V range
            if (manufacturer === 'belimo' && range === '0.5-10') {
                const adaptationMode = Math.abs(rawValue - adaptationRaw) < 10;
                channelData.adaptationMode = adaptationMode;
            }
            
            channels.push(channelData);
        }
        
        return { channels };
    }

    function makeMatcher(filter, fallbackExact) {
        if (filter && typeof filter === "string" && filter.length) {
            // regex: /.../
            if (filter.startsWith("/") && filter.endsWith("/")) {
                try { const re = new RegExp(filter.slice(1, -1)); return t => typeof t === "string" && re.test(t); }
                catch { return () => false; }
            }
            // wildcard: *
            if (filter.includes("*")) {
                const esc = s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
                const re = new RegExp("^" + esc(filter).replace(/\*/g, ".*") + "$");
                return t => typeof t === "string" && re.test(t);
            }
            // exact
            return t => t === filter;
        }
        // no filter -> exact match on type
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
        let currentAddress = 0;
        
        cards.forEach(c => {
            const type = (c.type || "").toUpperCase();
            const cardInfo = CARD_INFO[type];
            
            if (cardInfo) {
                routes.push({
                    type: type,
                    label: c.label || "",
                    filter: c.filter || "",
                    config: c.config || null,
                    startAddress: currentAddress,
                    size: cardInfo.size,
                    functionCode: cardInfo.fc,
                    match: makeMatcher(c.filter || "", c.type || "")
                });
                
                currentAddress += cardInfo.size;
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
                    // Attempt reconnect after 5 seconds
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

        // Poll all cards
        async function pollCards() {
            if (!client || !socket || socket.destroyed) {
                return;
            }

            const outs = new Array(routes.length).fill(null);

            for (let i = 0; i < routes.length; i++) {
                const route = routes[i];
                
                if (!route.size) {
                    continue;
                }

                try {
                    let response;
                    let data;
                    
                    // Use appropriate function code based on card type
                    if (route.functionCode === 'readCoils') {
                        // FC2 for digital inputs (KL1808)
                        response = await client.readDiscreteInputs(
                            route.startAddress, 
                            route.size
                        );
                        data = response.response._body._valuesAsArray;
                    } else {
                        // FC4 for analog inputs (KL3208, KL3468)
                        response = await client.readInputRegisters(
                            route.startAddress, 
                            route.size
                        );
                        data = response.response._body._valuesAsArray;
                    }
                    
                    // Process based on card type
                    let payload;
                    if (route.type === 'KL1808') {
                        payload = convertKL1808Data(data);
                    } else if (route.type === 'KL3208') {
                        payload = convertKL3208Data(data, route.config?.channels);
                    } else if (route.type === 'KL3468') {
                        payload = convertKL3468Data(data, route.config?.channels);
                    } else {
                        payload = data;
                    }
                    
                    outs[i] = {
                        topic: route.type,
                        payload: payload
                    };
                    
                } catch (err) {
                    node.warn(`Error reading ${route.type} at address ${route.startAddress}: ${err.message}`);
                    outs[i] = {
                        topic: route.type,
                        payload: { error: err.message }
                    };
                }
            }

            // Send to all outputs
            node.send(outs);
        }

        function startPolling() {
            if (pollTimer) clearInterval(pollTimer);
            pollTimer = setInterval(pollCards, pollInterval);
            pollCards(); // Poll immediately
        }

        function stopPolling() {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
        }

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