module.exports = function(RED){
  function BK9100Node(cfg){
    RED.nodes.createNode(this, cfg);
    const node = this;

    const cards = Array.isArray(cfg.cards) ? cfg.cards : [];

    // Build matchers (topic filters) once
    const matchers = cards.map((c, index) => {
      const type = (c.type || "").trim();
      const label = c.label || "";
      const filt = (c.topic || "").trim();

      let kind = "none";
      let re = null;
      let exact = null;

      if (filt) {
        if (filt.startsWith("/") && filt.endsWith("/")) {
          const body = filt.slice(1, -1);
          re = new RegExp(body);
          kind = "regex";
        } else if (filt.includes("*")) {
          const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const rx = "^" + filt.split("*").map(esc).join(".*") + "$";
          re = new RegExp(rx);
          kind = "wildcard";
        } else {
          exact = filt;
          kind = "exact";
        }
      }

      return { index, type, label, kind, exact, re };
    });

    function findRowByType(type){
      const ix = cards.findIndex(c => (c.type || "").trim() === type);
      return ix;
    }

    function inferTypeFromTopic(topic){
      const t = (topic || "");
      if (t.includes("KL1808")) return "KL1808";
      if (t.includes("KL3208")) return "KL3208";
      if (t.includes("KL3468")) return "KL3468";
      // Heuristics for your current names
      if (/_DI/i.test(t)) return "KL1808";
      if (/_AI/i.test(t)) return "KL3208";
      return "";
    }

    function findOutputIndex(msg){
      const topic = (typeof msg.topic === "string") ? msg.topic : "";

      // 1) explicit topic filter match
      for (const m of matchers) {
        if (m.kind === "regex"    && m.re.test(topic)) return m.index;
        if (m.kind === "wildcard" && m.re.test(topic)) return m.index;
        if (m.kind === "exact"    && m.exact && topic === m.exact) return m.index;
      }

      // 2) msg.cardType overrides
      if (msg && typeof msg.cardType === "string" && msg.cardType.trim()){
        const ix = findRowByType(msg.cardType.trim());
        if (ix >= 0) return ix;
      }

      // 3) infer from topic
      const inferred = inferTypeFromTopic(topic);
      if (inferred){
        const ix = findRowByType(inferred);
        if (ix >= 0) return ix;
      }

      // 4) final fallback: exact type == topic
      for (const m of matchers) {
        if (m.type && topic === m.type) return m.index;
      }
      return -1;
    }

    node.on("input", (msg, send, done) => {
      try {
        const idx = findOutputIndex(msg);
        const outs = new Array(Math.max(1, cards.length)).fill(null);
        if (idx >= 0) {
          outs[idx] = msg; // forward unchanged
          node.status({fill:"green", shape:"dot", text:`→ out ${idx+1} (${cards[idx]?.type || "?"})`});
        } else {
          node.status({fill:"yellow", shape:"ring", text:"no match"});
        }
        send(outs);
        done && done();
      } catch (e){
        node.status({fill:"red", shape:"dot", text:"error"});
        node.error(e, msg);
        done && done(e);
      }
    });
  }
  RED.nodes.registerType("BK9100", BK9100Node);
};
