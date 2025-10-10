module.exports = function(RED) {
  function BeckhoffRackNode(cfg) {
    RED.nodes.createNode(this, cfg);
    const node = this;

    const unitId   = Number(cfg.unitId || 1);
    const rackBase = Number(cfg.rackBase || 0);

    let layout;
    try { layout = Array.isArray(cfg.layout) ? cfg.layout : JSON.parse(cfg.layout || "[]"); }
    catch { layout = []; }
    const outputsCount = Number(cfg.outputsCount || (layout.length || 1));

    const MODELS = {
      "KL3468": { fc:4, channels:8, wordsPerCh:2, interleaved:true,  dataOffset:1, statusOffset:0, bitBased:false },
      "KL3208": { fc:4, channels:8, wordsPerCh:2, interleaved:true,  dataOffset:1, statusOffset:0, bitBased:false },
      "KL1808": { fc:2, channels:8, wordsPerCh:1, interleaved:false, dataOffset:0, statusOffset:null, bitBased:true  },
      "KL3464": { fc:4, channels:4, wordsPerCh:2, interleaved:true,  dataOffset:1, statusOffset:0, bitBased:false },
      "KL3204": { fc:4, channels:4, wordsPerCh:2, interleaved:true,  dataOffset:1, statusOffset:0, bitBased:false }
    };

    function computeMap(base0) {
      let base = Number.isFinite(base0) ? Number(base0) : rackBase;
      const rows = (layout || []).map((it, idx) => {
        const meta = MODELS[it.model] || MODELS["KL3468"];
        const length = meta.channels * meta.wordsPerCh;
        const start = base;
        base += length;
        return {
          slot: idx+1,
          model: it.model,
          unitId,
          fc: meta.fc,
          start,
          length,
          channels: meta.channels,
          wordsPerCh: meta.wordsPerCh,
          interleaved: meta.interleaved,
          bitBased: meta.bitBased,
          dataOffset: meta.dataOffset,
          statusOffset: meta.statusOffset
        };
      });
      return rows;
    }

    function emitRows(rows){
      // build array of messages, one per output
      const msgs = [];
      for (let i=0; i<rows.length; i++){
        msgs[i] = { payload: rows[i], topic: `slot/${rows[i].slot}/${rows[i].model}` };
      }
      // if node has more outputs than rows (or fewer), pad with nulls
      while (msgs.length < outputsCount) msgs.push(null);
      node.send(msgs);
    }

    function run(baseOverride){
      const rows = computeMap(baseOverride);
      emitRows(rows);
      node.status({fill:"blue", shape:"ring", text:`outputs: ${rows.length}`});
    }

    // emit once on deploy
    try { run(); } catch(e){ node.error(e); node.status({fill:"red", shape:"dot", text:"init error"}); }

    // re-emit on any input; allow msg.rackBase override
    node.on('input', (msg, send, done) => {
      try {
        const override = (msg && Number.isFinite(Number(msg.rackBase))) ? Number(msg.rackBase) : undefined;
        run(override);
        done && done();
      } catch(e) {
        node.error(e, msg);
        node.status({fill:"red", shape:"dot", text:"error"});
        done && done(e);
      }
    });
  }

  RED.nodes.registerType("beckhoff-rack", BeckhoffRackNode);
};
