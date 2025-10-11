module.exports = function (RED) {

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
            const stateIdx = ch * 2;      // 0, 2, 4, 6, 8, 10, 12, 14
            const dataIdx = ch * 2 + 1;   // 1, 3, 5, 7, 9, 11, 13, 15
            
            const state = rawArray[stateIdx];
            let rawValue = rawArray[dataIdx];
            
            const sensorType = channelConfigs?.[ch] || 'pt1000';
            
            // Convert signed 16-bit integer
            // Positive values: 0-32767 (as-is)
            // Negative values: 32768-65535 (convert from two's complement)
            if (rawValue > 32767) {
                rawValue = rawValue - 65536;
            }
            
            // Raw value is in hundredths of a degree (divide by 100)
            // 2400 = 24.00°C, 600 = 6.00°C, -1500 = -15.00°C
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

        const routes = cards.map(c => ({
            type:  c.type  || "",
            label: c.label || "",
            filter: c.filter || "",
            config: c.config || null,
            match: makeMatcher(c.filter || "", c.type || "")
        }));

        node.status({ fill: "grey", shape: "dot", text: `${routes.length} outputs` });

        node.on('input', function (msg, send, done) {
            try {
                const topic = msg.topic;
                const outs = new Array(Math.max(1, routes.length)).fill(null);
                let hits = 0;

                routes.forEach((r, i) => {
                    if (r.match(topic)) {
                        let outMsg = RED.util.cloneMessage(msg);
                        
                        // Process KL1808 data if applicable
                        if (r.type.toUpperCase() === 'KL1808' && Array.isArray(msg.payload)) {
                            const converted = convertKL1808Data(msg.payload);
                            outMsg.payload = converted;
                        }
                        // Process KL3208 data if applicable
                        else if (r.type.toUpperCase() === 'KL3208' && Array.isArray(msg.payload)) {
                            const converted = convertKL3208Data(msg.payload, r.config?.channels);
                            outMsg.payload = converted;
                        }
                        
                        outs[i] = outMsg;
                        hits++;
                    }
                });

                node.status({
                    fill: hits ? "green" : "yellow",
                    shape: hits ? "dot" : "ring",
                    text: `${topic ?? '(no topic)'} → ${hits}/${routes.length || 1}`
                });

                send(outs);
                done && done();
            } catch (err) {
                node.status({ fill: "red", shape: "ring", text: "error" });
                done ? done(err) : node.error(err, msg);
            }
        });
    }

    RED.nodes.registerType("BK9100", BK9100Node);
};