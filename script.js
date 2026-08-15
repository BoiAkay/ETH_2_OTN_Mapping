(function(){

  const THEME_KEY = 'eth-otn-theme';

  function applyTheme(theme){
    const isLight = theme === 'light';
    document.body.classList.toggle('light-mode', isLight);
    const toggle = document.getElementById('theme-toggle');
    if (toggle){
      toggle.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
    }
    const darkOption = document.querySelector('.theme-option:nth-child(2)');
    const lightOption = document.querySelector('.theme-option:nth-child(3)');
    if (darkOption && lightOption){
      darkOption.classList.toggle('active', !isLight);
      lightOption.classList.toggle('active', isLight);
    }
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }

  const savedTheme = (() => {
    try {
      return localStorage.getItem(THEME_KEY) || 'dark';
    } catch (e) {
      return 'dark';
    }
  })();

  applyTheme(savedTheme);
  document.getElementById('theme-toggle').addEventListener('click', ()=>{
    const nextTheme = document.body.classList.contains('light-mode') ? 'dark' : 'light';
    applyTheme(nextTheme);
  });

  // ---------------- CRC helpers (verified against CRC-16/XMODEM and CRC-32 test vectors) ----------------
  function crc16(bytes){
    let crc = 0x0000;
    for (const b of bytes){
      crc ^= (b << 8);
      for (let i=0;i<8;i++){
        crc = (crc & 0x8000) ? ((crc<<1) ^ 0x1021) : (crc<<1);
        crc &= 0xFFFF;
      }
    }
    return crc;
  }
  function crc32(bytes){
    let crc = 0xFFFFFFFF;
    for (const b of bytes){
      crc ^= b;
      for (let i=0;i<8;i++){
        crc = (crc & 1) ? ((crc>>>1) ^ 0xEDB88320) : (crc>>>1);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function hex(n, width){ return n.toString(16).toUpperCase().padStart(width,'0'); }
  function u16bytes(n){ return [ (n>>8)&0xFF, n&0xFF ]; }
  function u32bytes(n){ return [ (n>>>24)&0xFF, (n>>>16)&0xFF, (n>>>8)&0xFF, n&0xFF ]; }

  // ---------------- Domain data ----------------
  const RATES = {
    '1gbe': {
      label:'1GbE', full:'1000BASE-X (1GbE)',
      clientRate:'1.25 Gbit/s (8B/10B line rate)',
      standard:'gfpf',
      containers:{
        gfpf:{name:'ODU0', rate:'1.244160 Gbit/s', standard:true},
        bmp:{name:'ODU0', rate:'1.244160 Gbit/s', standard:false},
        gmp:{name:'ODUflex(CBR)', rate:'~1.25 Gbit/s (sized to client)', standard:false}
      }
    },
    '10gbe-lan':{
      label:'10GbE LAN', full:'10GBASE-R LAN PHY (10GbE)',
      clientRate:'10.3125 Gbit/s (64B/66B line rate)',
      standard:'bmp',
      containers:{
        bmp:{name:'ODU2e', rate:'10.399526 Gbit/s', standard:true},
        gfpf:{name:'ODU2', rate:'10.037274 Gbit/s', standard:false},
        gmp:{name:'ODUflex(CBR)', rate:'~10.3 Gbit/s (sized to client)', standard:false}
      }
    },
    '10gbe-wan':{
      label:'10GbE WAN', full:'10GBASE-W WAN PHY (10GbE)',
      clientRate:'9.953 Gbit/s (SONET/SDH-framed)',
      standard:'bmp',
      containers:{
        bmp:{name:'ODU2', rate:'10.037274 Gbit/s', standard:true},
        gfpf:{name:'ODU2', rate:'10.037274 Gbit/s', standard:false},
        gmp:{name:'ODUflex(CBR)', rate:'~9.95 Gbit/s (sized to client)', standard:false}
      }
    },
    '40gbe':{
      label:'40GbE', full:'40GBASE-R (40GbE)',
      clientRate:'41.25 Gbit/s (64B/66B line rate)',
      standard:'gmp',
      containers:{
        gmp:{name:'ODU3e2 (after TTT transcoding)', rate:'41.785969 Gbit/s', standard:true},
        gfpf:{name:'ODU3', rate:'40.319219 Gbit/s', standard:false},
        bmp:{name:'ODU3', rate:'40.319219 Gbit/s', standard:false}
      }
    },
    '100gbe':{
      label:'100GbE', full:'100GBASE-R (100GbE)',
      clientRate:'103.125 Gbit/s (64B/66B line rate)',
      standard:'bmp',
      containers:{
        bmp:{name:'ODU4', rate:'104.794446 Gbit/s', standard:true},
        gfpf:{name:'ODU4', rate:'104.794446 Gbit/s', standard:false},
        gmp:{name:'ODUflex(CBR)', rate:'~103 Gbit/s (sized to client)', standard:false}
      }
    }
  };

  const PROC_INFO = {
    gfpf:{ label:'GFP-F', full:'Generic Framing Procedure — Frame-mapped (G.7041)' },
    bmp:{ label:'BMP', full:'Bit-synchronous Mapping Procedure' },
    gmp:{ label:'GMP', full:'Generic Mapping Procedure' }
  };

  const COLORS = {
    fas:'#EF6B84', otuoh:'#EF6B84', oduoh:'#8DA0F5', opuoh:'#4FD8C4',
    payload:'#F2A93C', fec:'#C77DFF'
  };

  let state = { rate:'10gbe-lan', procedure:'bmp', pinnedRegion:null };

  // ---------------- Build controls ----------------
  const rateRow = document.getElementById('rate-row');
  Object.keys(RATES).forEach(key=>{
    const b = document.createElement('button');
    b.className='opt-btn'; b.textContent = RATES[key].label; b.dataset.rate = key;
    b.addEventListener('click', ()=>{ state.rate = key; render(); });
    rateRow.appendChild(b);
  });

  const procRow = document.getElementById('proc-row');
  procRow.id = 'proc-row';
  Object.keys(PROC_INFO).forEach(key=>{
    const b = document.createElement('button');
    b.className='opt-btn'; b.textContent = PROC_INFO[key].label; b.dataset.proc = key;
    b.addEventListener('click', ()=>{ state.procedure = key; render(); });
    procRow.appendChild(b);
  });

  document.getElementById('payload-text').addEventListener('input', render);

  // ---------------- Ethernet frame builder ----------------
  function buildEthernetFrame(text){
    const DA = [0x02,0x00,0x00,0x00,0x00,0x02];
    const SA = [0x02,0x00,0x00,0x00,0x00,0x01];
    const ETHERTYPE = [0x88,0xB5]; // IEEE-reserved local experimental ethertype
    let dataBytes = Array.from(new TextEncoder().encode(text || ''));
    if (dataBytes.length > 1000) dataBytes = dataBytes.slice(0,1000);
    let padded = dataBytes.slice();
    const minData = 46;
    while (padded.length < minData) padded.push(0x00);
    const noFcs = [...DA, ...SA, ...ETHERTYPE, ...padded];
    const fcs = crc32(noFcs);
    const frame = [...noFcs, ...u32bytes(fcs)];
    return { DA, SA, ETHERTYPE, dataBytes, padded, fcs, frame, wasPadded: dataBytes.length < minData };
  }

  // ---------------- GFP-F builder ----------------
  function buildGfpF(ethFrameBytes){
    const PTI = 0b000, PFI = 1, EXI = 0b0000, UPI = 0x01;
    const typeField = (PTI<<13) | (PFI<<12) | (EXI<<8) | UPI;
    const typeBytes = u16bytes(typeField);
    const tHEC = crc16(typeBytes);
    const payloadFcs = crc32(ethFrameBytes);
    const payloadAreaLen = 4 /*payload header, null ext*/ + ethFrameBytes.length + 4 /*FCS*/;
    const cHEC = crc16(u16bytes(payloadAreaLen));
    return {
      PTI, PFI, EXI, UPI, typeField, typeBytes, tHEC,
      payloadFcs, PLI: payloadAreaLen, cHEC,
      totalLen: 4 + payloadAreaLen
    };
  }

  // ---------------- GMP illustrative fill pattern ----------------
  function gmpPattern(nCells, fillRatio){
    const k = Math.round(nCells * fillRatio);
    const cells = [];
    for (let i=0;i<nCells;i++){
      const isData = Math.floor((i+1)*k/nCells) - Math.floor(i*k/nCells) === 1;
      cells.push(isData);
    }
    return cells;
  }

  function containerRateGbps(rateKey, procKey){
    const map = {
      '1gbe':{gfpf:1.24416, bmp:1.24416, gmp:1.25},
      '10gbe-lan':{bmp:10.399526, gfpf:10.037274, gmp:10.3},
      '10gbe-wan':{bmp:10.037274, gfpf:10.037274, gmp:9.95},
      '40gbe':{gmp:41.785969, gfpf:40.319219, bmp:40.319219},
      '100gbe':{bmp:104.794446, gfpf:104.794446, gmp:103}
    };
    return map[rateKey][procKey];
  }
  function clientRateGbps(rateKey){
    const map = {'1gbe':1.25,'10gbe-lan':10.3125,'10gbe-wan':9.953,'40gbe':41.25,'100gbe':103.125};
    return map[rateKey];
  }

  // ---------------- Rendering ----------------
  function render(){
    const rateInfo = RATES[state.rate];
    const container = rateInfo.containers[state.procedure];
    const isStandard = rateInfo.standard === state.procedure;

    document.querySelectorAll('#rate-row .opt-btn').forEach(b=>{
      b.classList.toggle('active', b.dataset.rate === state.rate);
    });
    document.querySelectorAll('#proc-row .opt-btn').forEach(b=>{
      b.classList.toggle('active', b.dataset.proc === state.procedure);
    });

    const badgeRow = document.getElementById('badge-row');
    badgeRow.innerHTML = '';
    const badge = document.createElement('span');
    if (isStandard){
      badge.className = 'badge standard';
      badge.textContent = '✓ Standard pairing (G.709)';
    } else {
      badge.className = 'badge nonstandard';
      badge.textContent = '⚠ Non-standard pairing — shown for comparison';
    }
    const note = document.createElement('span');
    note.className = 'badge-note';
    note.textContent = isStandard
      ? `${rateInfo.full} is conventionally mapped this way into ${container.name}.`
      : `${rateInfo.full} is normally mapped via ${PROC_INFO[rateInfo.standard].label} into ${rateInfo.containers[rateInfo.standard].name}. This view shows ${PROC_INFO[state.procedure].label} into ${container.name} instead.`;
    badgeRow.appendChild(badge);
    badgeRow.appendChild(note);

    const payloadText = document.getElementById('payload-text').value;
    const eth = buildEthernetFrame(payloadText);

    renderPipeline(rateInfo, container, eth);
    renderFrameGrid();
  }

  function bar(segments){
    const div = document.createElement('div');
    div.className='bytebar';
    segments.forEach(s=>{
      const seg = document.createElement('div');
      seg.style.flex = s.w;
      seg.style.background = s.color;
      seg.textContent = s.label || '';
      div.appendChild(seg);
    });
    return div;
  }

  function chip(label, value){
    const c = document.createElement('span');
    c.className='field-chip';
    c.innerHTML = label + ': <b>' + value + '</b>';
    return c;
  }

  function renderPipeline(rateInfo, container, eth){
    const wrap = document.getElementById('pipeline-stages');
    wrap.innerHTML = '';

    function addStage(accentVar, title, meta, bodyBuilder){
      const s = document.createElement('div');
      s.className='stage';
      s.style.setProperty('--stage-accent', accentVar);
      const head = document.createElement('div');
      head.className='stage-head';
      const t = document.createElement('div'); t.className='stage-title'; t.textContent = title;
      const m = document.createElement('div'); m.className='stage-meta'; m.textContent = meta;
      head.appendChild(t); head.appendChild(m);
      s.appendChild(head);
      const body = document.createElement('div');
      body.className='stage-body';
      bodyBuilder(body);
      s.appendChild(body);
      wrap.appendChild(s);
      const arrow = document.createElement('div');
      arrow.className='stage-arrow'; arrow.textContent='↓';
      wrap.appendChild(arrow);
    }

    addStage('var(--accent-eth)', 'Ethernet MAC frame', eth.frame.length + ' bytes', (body)=>{
      const p1 = document.createElement('p');
      p1.textContent = 'Preamble (7B) + SFD (1B) are physical-layer sync patterns — stripped before the MAC frame is handed to the OTN mapping function.';
      body.appendChild(p1);
      body.appendChild(bar([
        {w:6, color:'#3A3320', label:'DA 6B'},
        {w:6, color:'#453B24', label:'SA 6B'},
        {w:2, color:'#514428', label:'Type'},
        {w:Math.max(eth.padded.length,10), color:'var(--accent-eth)', label:'Data ' + eth.padded.length + 'B'},
        {w:4, color:'#3A3320', label:'FCS'}
      ]));
      const chips = document.createElement('div'); chips.className='field-chip-row';
      chips.appendChild(chip('EtherType', '0x' + hex((eth.ETHERTYPE[0]<<8)|eth.ETHERTYPE[1],4) + ' (IEEE local-experimental)'));
      chips.appendChild(chip('FCS (CRC-32)', '0x' + hex(eth.fcs,8)));
      if (eth.wasPadded) chips.appendChild(chip('Padding', 'to 46B minimum data field'));
      body.appendChild(chips);
    });

    if (state.procedure === 'gfpf'){
      const gfp = buildGfpF(eth.frame);
      addStage('var(--accent-map)', 'GFP-F encapsulation', gfp.totalLen + ' bytes', (body)=>{
        const p1 = document.createElement('p');
        p1.textContent = 'The Ethernet frame becomes the GFP Payload Information Field, wrapped in a Core Header and Payload Header per G.7041.';
        body.appendChild(p1);
        body.appendChild(bar([
          {w:2, color:'#1D4A44', label:'PLI'},
          {w:2, color:'#1D4A44', label:'cHEC'},
          {w:2, color:'#2A6058', label:'Type'},
          {w:2, color:'#2A6058', label:'tHEC'},
          {w:Math.max(eth.frame.length,20), color:'var(--accent-map)', label:'Ethernet frame (payload info field)'},
          {w:4, color:'#2A6058', label:'FCS'}
        ]));
        const chips = document.createElement('div'); chips.className='field-chip-row';
        chips.appendChild(chip('PLI', gfp.PLI + ' (0x' + hex(gfp.PLI,4) + ')'));
        chips.appendChild(chip('cHEC (CRC-16)', '0x' + hex(gfp.cHEC,4)));
        chips.appendChild(chip('Type field', '0x' + hex(gfp.typeField,4) + ' — PTI=000 PFI=1 EXI=0000 UPI=0x01 (frame-mapped Ethernet)'));
        chips.appendChild(chip('tHEC (CRC-16)', '0x' + hex(gfp.tHEC,4)));
        chips.appendChild(chip('Payload FCS (CRC-32)', '0x' + hex(gfp.payloadFcs,8)));
        body.appendChild(chips);
      });
    } else if (state.procedure === 'bmp'){
      addStage('var(--accent-map)', 'Bit-synchronous mapping (BMP)', 'no extra framing overhead', (body)=>{
        const p1 = document.createElement('p');
        p1.textContent = 'No intermediate frame is built. The client bit stream is clocked directly, byte-for-byte, into the OPU payload area — the OPU clock is derived from the recovered client clock itself.';
        body.appendChild(p1);
        const p2 = document.createElement('p');
        p2.textContent = 'Small clock differences between the client and the local ODU clock are absorbed by dedicated Justification Control bytes (JC1–JC3) and Positive/Negative Justification Opportunity bytes (PJO/NJO) carried in the OPU overhead — not shown as a separate frame here because BMP does not add one.';
        body.appendChild(p2);
        body.appendChild(bar([
          {w:1, color:'#2A6058', label:'JC'},
          {w:Math.max(eth.frame.length,20), color:'var(--accent-map)', label:'client bit stream, mapped directly'}
        ]));
      });
    } else {
      const fillRatio = Math.min(0.99, clientRateGbps(state.rate) / containerRateGbps(state.rate, 'gmp'));
      const nCells = 120;
      const cells = gmpPattern(nCells, fillRatio);
      addStage('var(--accent-map)', 'Generic mapping (GMP)', Math.round(fillRatio*100) + '% data cells (illustrative)', (body)=>{
        const p1 = document.createElement('p');
        p1.textContent = 'GMP signals a count (Cm) each mapping period — how many client bytes appear in the next interval, out of a fixed number of payload byte positions. Positions that do not get a client byte carry stuff (dummy) bytes instead.';
        body.appendChild(p1);
        const p2 = document.createElement('p');
        p2.textContent = 'The pattern below spreads data and stuff cells as evenly as possible across a mapping period — the same principle GMP\'s justification pattern relies on — sized to the ratio between the ' + RATES[state.rate].label + ' client rate and the ' + container.name + ' container rate. This is a simplified illustration, not the literal G.709 Cm sequence.';
        body.appendChild(p2);
        const mosaic = document.createElement('div'); mosaic.className='mosaic';
        cells.forEach(isData=>{
          const d = document.createElement('div');
          d.style.background = isData ? 'var(--accent-map)' : '#2A3242';
          mosaic.appendChild(d);
        });
        body.appendChild(mosaic);
        const chips = document.createElement('div'); chips.className='field-chip-row';
        chips.appendChild(chip('Client rate', clientRateGbps(state.rate) + ' Gbit/s'));
        chips.appendChild(chip('Container rate', containerRateGbps(state.rate,'gmp') + ' Gbit/s'));
        chips.appendChild(chip('Data : stuff', Math.round(fillRatio*100) + '% : ' + Math.round((1-fillRatio)*100) + '%'));
        body.appendChild(chips);
      });
    }

    addStage('var(--accent-odu)', 'OPU — Optical Payload Unit', container.name + ' payload', (body)=>{
      const p1 = document.createElement('p');
      p1.textContent = 'The mapped client data occupies the OPU payload area (columns 17–3824 of the frame). OPU overhead (columns 15–16) carries the Payload Structure Identifier and, for BMP/GMP, the justification control bytes.';
      body.appendChild(p1);
      body.appendChild(bar([
        {w:2, color:'var(--accent-odu-dim)', label:'OPU OH'},
        {w:40, color:'var(--accent-odu)', label:'OPU payload — columns 17–3824'}
      ]));
      const chips = document.createElement('div'); chips.className='field-chip-row';
      chips.appendChild(chip('Target container', container.name));
      chips.appendChild(chip('Container rate', container.rate));
      body.appendChild(chips);
    });

    addStage('var(--accent-odu)', 'ODU — Optical Data Unit', 'adds path-level overhead', (body)=>{
      const p1 = document.createElement('p');
      p1.textContent = 'ODU overhead (rows 2–4, columns 1–14) wraps the OPU: end-to-end Path Monitoring (PM), up to six levels of Tandem Connection Monitoring (TCM1–TCM6), and general management fields.';
      body.appendChild(p1);
      body.appendChild(bar([
        {w:14, color:'var(--accent-odu)', label:'ODU overhead'},
        {w:2, color:'var(--accent-odu-dim)', label:'OPU OH'},
        {w:40, color:'#6E7FB8', label:'OPU payload'}
      ]));
    });

    addStage('var(--accent-otu)', 'OTU — Optical Transport Unit', 'complete transmitted frame', (body)=>{
      const p1 = document.createElement('p');
      p1.textContent = 'The final frame adds Frame Alignment (FAS/MFAS), OTU section-monitoring overhead, and Forward Error Correction across a fixed 4×4080-byte structure — regardless of which client or mapping procedure was used upstream.';
      body.appendChild(p1);
      body.appendChild(bar([
        {w:7, color:'var(--accent-otu)', label:'FAS'},
        {w:7, color:'var(--accent-otu)', label:'OTU OH'},
        {w:42, color:'var(--accent-odu-dim)', label:'ODU + OPU'},
        {w:20, color:'var(--accent-fec)', label:'FEC'}
      ]));
      const chips = document.createElement('div'); chips.className='field-chip-row';
      chips.appendChild(chip('Frame size', '4 × 4080 bytes'));
      chips.appendChild(chip('FEC', 'RS(255,239), columns 3825–4080'));
      body.appendChild(chips);
    });

    if (wrap.lastChild && wrap.lastChild.classList.contains('stage-arrow')) {
      wrap.removeChild(wrap.lastChild);
    }
  }

  const REGIONS = [
    { key:'fas', label:'FAS / MFAS', cols:'Row 1, cols 1–7', width:7, rows:[0], color:COLORS.fas,
      desc:'Frame Alignment Signal (6 bytes) plus a Multi-Frame Alignment Signal byte. Lets the receiver find the start of every OTU frame and track a 256-frame multiframe used to schedule other overhead.' },
    { key:'otuoh', label:'OTU overhead', cols:'Row 1, cols 8–14', width:7, rows:[0], color:COLORS.otuoh,
      desc:'Section Monitoring (SM, with a BIP-8 covering the OPU) and General Communication Channel 0 (GCC0), terminated at every OTU regenerator — the section-layer supervisory channel.' },
    { key:'oduoh', label:'ODU overhead', cols:'Rows 2–4, cols 1–14', width:14, rows:[1,2,3], color:COLORS.oduoh,
      desc:'Path Monitoring (PM) plus up to six Tandem Connection Monitoring levels (TCM1–TCM6), along with APS/PCC, FTFL and GCC1/GCC2 fields — end-to-end and segment-level supervision for the ODU.' },
    { key:'opuoh', label:'OPU overhead', cols:'Rows 1–4, cols 15–16', width:2, rows:[0,1,2,3], color:COLORS.opuoh,
      desc:'Payload Structure Identifier (including the Payload Type byte) plus mapping-specific justification control bytes — the fields that record which client and which mapping procedure (GFP-F / BMP / GMP) were used.' },
    { key:'payload', label:'OPU payload', cols:'Rows 1–4, cols 17–3824', width:3808, rows:[0,1,2,3], color:COLORS.payload,
      desc:'3,808 columns × 4 rows = 15,232 bytes per frame. This is where the mapped client data actually lives — everything upstream in the pipeline exists to get bytes into this region correctly.' },
    { key:'fec', label:'FEC', cols:'Cols 3825–4080', width:256, rows:[0,1,2,3], color:COLORS.fec,
      desc:'Reed–Solomon RS(255,239) forward error correction, interleaved across 16 sub-frames. This is what lets OTN operate at a useful margin below the raw optical-layer error floor.' }
  ];

  function renderFrameGrid(){
    const rowsWrap = document.getElementById('frame-rows');
    rowsWrap.innerHTML = '';
    const totalCols = 4080;
    for (let r=0;r<4;r++){
      const rowDiv = document.createElement('div');
      rowDiv.className='frame-row';
      const rowLabel = document.createElement('div');
      rowLabel.className='frame-row-label';
      rowLabel.textContent = 'Row ' + (r+1);
      rowDiv.appendChild(rowLabel);
      const track = document.createElement('div');
      track.className='frame-row-track';
      REGIONS.forEach(reg=>{
        if (reg.rows.includes(r)){
          const seg = document.createElement('div');
          seg.className='frame-seg';
          seg.style.flex = reg.width;
          seg.style.background = reg.color;
          seg.dataset.key = reg.key;
          seg.addEventListener('click', ()=> showRegion(reg));
          seg.addEventListener('mouseenter', ()=> showRegion(reg, true));
          track.appendChild(seg);
        }
      });
      rowDiv.appendChild(track);
      rowsWrap.appendChild(rowDiv);
    }

    const legend = document.getElementById('legend');
    legend.innerHTML = '';
    REGIONS.forEach(reg=>{
      const item = document.createElement('div'); item.className='legend-item';
      const sw = document.createElement('span'); sw.className='legend-swatch'; sw.style.background = reg.color;
      item.appendChild(sw);
      item.appendChild(document.createTextNode(reg.label));
      item.style.cursor='pointer';
      item.addEventListener('click', ()=> showRegion(reg));
      legend.appendChild(item);
    });

    document.getElementById('frame-scale-note').textContent =
      'Rendered true-to-scale by column width: overhead occupies only ' +
      Math.round((16/4080)*1000)/10 + '% of each frame — most of a 4080-column frame is payload and FEC.';

    if (!state.pinnedRegion) showRegion(REGIONS[4]);
  }

  function showRegion(reg, isHover){
    if (!isHover) state.pinnedRegion = reg.key;
    const detail = document.getElementById('frame-detail');
    detail.innerHTML = '<b>' + reg.label + '</b> &nbsp; <span class="cols">' + reg.cols + '</span><br>' + reg.desc;
  }

  render();
})();
