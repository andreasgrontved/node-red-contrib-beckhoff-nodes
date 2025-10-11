module.exports = function(RED){
  function BK9100Node(cfg){
    RED.nodes.createNode(this, cfg);
    const node = this;

    // From your editor: an ordered array of rows/cards.
    // We'll build a match list in the same order so outputs line up.
    const cards = Array.isArray(cfg.cards) ? cfg.cards : [];

    // Build simple exact-match list.
    // Prefer an explicit topic from the editor (if you added one),
    // otherwise fall back to the card type ("KL1808", "KL3208", ...).
    const matchList = cards.map(c => {
      const t = (c && typeof c.topic === "string" && c.topic.trim()) || "";
      const ty = (c && typeof c.type  === "string" && c.type.trim())  || "";
      return t || ty; // exact string we will compare to msg.topic
    });

    // Helper: exact match index
    function findIndexByTopic(topic){
      if (typeof topic !== "string") return -1;
      const t = topic.trim();
      // 1) match against configured items
      for (let i = 0; i < matchList.length; i++){
        if (t === matchList[i]) return i;
      }
      // 2) convenience fallback for common types if user didn’t configure rows:
      const builtin = ["KL1808","KL3208","KL3468"];
      const bi = builtin.indexOf(t);
      if (bi >= 0 && bi < matchList.length) return bi;
      return -1;
    }

    node.on("input", (msg, send, done) => {
      try {
        const outs = new Array(Math.max(1, matchList.length)).fill(null);
        const idx = findIndexByTopic(msg.topic);

        if (idx >= 0){
          // forward only the payload (as requested), keep topic
          outs[idx] = { payload: msg.payload, topic: msg.topic };
          node.status({fill:"green", shape:"dot", text:`${msg.topic} → out ${idx+1}`});
        } else {
          node.status({fill:"yellow", shape:"ring", text:`no match: ${String(msg.topic||"")}`});
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
