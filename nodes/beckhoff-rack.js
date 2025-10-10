module.exports = function(RED) {
  function BeckhoffRackNode(cfg) {
    RED.nodes.createNode(this, cfg);
    const node = this;

    const unitId   = Number(cfg.unitId || 1);
    const rackBase = Number(cfg.rackBase || 0);
    let layout = [];
    try { layout = Array.isArray(cfg.layout) ? cfg.layout : JSON.parse(cfg.layout || "[]"); }
    catch { layout = []; }

    // same metadata as in HTML
    const MODELS = {
      "KL3468": { fc:4, channels:8, wordsPerCh:2, interleaved:true,  dataOffset:1, statusOffset:0, bitBased:false },
      "KL3208": { fc:4, channels:8, wordsPerCh:2, interleaved:true,  dataOffset:1, statusOffset:0, bitBased:false },
      "KL1808": { fc:2, channels:8, wordsPerCh:1, interleaved:false, dataOffset:0, statusOffset:null, bitBased:true  },
      "KL3464": { fc:4, channels:4, wordsPerCh:2, interleaved:true,  dataOffset:1, statusOffset:0, bitBased:false },
      "KL3204": { fc:4, channels:4, wordsPerCh:2, interleaved:true,  dataOffset:1, statusOffset:0, bitBased:false }
    };

    function computeMap(customBase) {
      const base0 = Number.isFinite(customBase) ? Number(customBase) : rackBase;
      let base = base0;
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

    function emitAll(rows){
      rows.forEach(r => {
        node.send({
          payload: r,
          topic: `slot/${r.slot}/${r.model}`
        });
      });
    }

    node.on('input', (msg, send, done) => {
      try {
        const baseOverride = (msg && Number.isFinite(Number(msg.rackBase))) ? Number(msg.rackBase) : undefined;
        const rows = computeMap(baseOverride);
        emitAll(rows);
        node.status({fill:"green", shape:"dot", text:`emitted ${rows.length} slots`});
        done && done();
      } catch (e) {
        node.status({fill:"red", shape:"dot", text:"error"});
        node.error(e, msg);
        done && done(e);
      }
    });

    // emit once on deploy/start
    try {
      const rows = computeMap();
      emitAll(rows);
      node.status({fill:"blue", shape:"ring", text:`ready (${rows.length} slots)`});
    } catch(e) {
      node.status({fill:"red", shape:"dot", text:"init error"});
      node.error(e);
    }
  }

  RED.nodes.registerType("beckhoff-rack", BeckhoffRackNode);
};
