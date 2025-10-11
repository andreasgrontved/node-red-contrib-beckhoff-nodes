module.exports = function (RED) {

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

        // cards might arrive as string if editor serialized oddly
        let cards = config.cards;
        if (typeof cards === "string") {
            try { cards = JSON.parse(cards); } catch { cards = []; }
        }
        if (!Array.isArray(cards)) cards = [];

        const routes = cards.map(c => ({
            type:  c.type  || "",
            label: c.label || "",
            filter:c.filter|| "",
            match: makeMatcher(c.filter || "", c.type || "")
        }));

        node.status({ fill: "grey", shape: "dot", text: `${routes.length} outputs` });

        node.on('input', function (msg, send, done) {
            try {
                const topic = msg.topic;
                const outs = new Array(Math.max(1, routes.length)).fill(null);
                let hits = 0;

                routes.forEach((r, i) => {
                    if (r.match(topic)) { outs[i] = msg; hits++; }
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
