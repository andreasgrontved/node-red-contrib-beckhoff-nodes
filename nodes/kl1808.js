module.exports = function(RED) {
  function KL1808Node(cfg) {
    RED.nodes.createNode(this, cfg);
    const node = this;

    node.status({fill:"grey", shape:"ring", text:"waiting array (DI 0..7)"});

    function toBool(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      if (n === 0) return false;
      if (n === 1) return true;
      // treat any non-zero as true
      return true;
    }

    function arrayToOutputs(arr, baseMsg) {
      const outs = new Array(8).fill(null);
      for (let i = 0; i < 8; i++) {
        const raw = arr[i];
        const b = toBool(raw);
        outs[i] = {
          ...baseMsg,
          payload: b,
          raw: raw,
          index: i
        };
      }
      return outs;
    }

    node.on('input', (msg, send, done) => {
      try {
        // array in msg.payload
        if (Array.isArray(msg.payload)) {
          const outs = arrayToOutputs(msg.payload, { topic: msg.topic });
          node.status({fill:"green", shape:"dot", text:"array → DI 1..8"});
          send(outs);
          return done && done();
        }
        // {data:[...]}
        if (msg && msg.payload && Array.isArray(msg.payload.data)) {
          const outs = arrayToOutputs(msg.payload.data, { topic: msg.topic });
          node.status({fill:"green", shape:"dot", text:"data[] → DI 1..8"});
          send(outs);
          return done && done();
        }
        // single value with msg.index
        if (typeof msg.payload === 'number' && Number.isInteger(msg.index)) {
          const idx = Number(msg.index);
          const b = toBool(msg.payload);
          const outs = new Array(8).fill(null);
          if (idx >= 0 && idx < 8) {
            outs[idx] = {
              topic: msg.topic,
              payload: b,
              raw: msg.payload,
              index: idx
            };
            node.status({fill:"green", shape:"dot", text:`single → DI ${idx+1}`});
          } else {
            node.status({fill:"yellow", shape:"ring", text:`index ${idx} out of range`});
          }
          send(outs);
          return done && done();
        }

        node.status({fill:"red", shape:"ring", text:"expected array or number+index"});
        done && done();
      } catch (err) {
        node.status({fill:"red", shape:"dot", text:"error"});
        node.error(err, msg);
        done && done(err);
      }
    });
  }

  RED.nodes.registerType("KL1808", KL1808Node);
};
