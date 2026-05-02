/*  UDF Okuyucu - Binnur Harpci icin tasarlandi  */

const $ = (s) => document.querySelector(s);
const heroSection    = $('#heroSection');
const loadingSection = $('#loadingSection');
const resultSection  = $('#resultSection');
const errorSection   = $('#errorSection');
const dropZone       = $('#dropZone');
const fileInput      = $('#fileInput');

let DATA = { name: '', contentXml: '', propsXml: '', files: {}, allText: '' };

// ── Events ──
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => { if (e.target.files[0]) processFile(e.target.files[0]); });
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
});

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        const id = 'tab' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1);
        document.getElementById(id).classList.add('active');
    });
});

$('#btnDownloadPdf').addEventListener('click', downloadPdf);
$('#btnDownloadTxt').addEventListener('click', downloadTxt);
$('#btnNewFile').addEventListener('click', reset);
$('#btnRetry').addEventListener('click', reset);

// ── Sections ──
function show(s) {
    [heroSection, loadingSection, resultSection, errorSection].forEach(x => x.classList.add('hidden'));
    s.classList.remove('hidden');
}
function reset() {
    fileInput.value = '';
    DATA = { name: '', contentXml: '', propsXml: '', files: {}, allText: '' };
    show(heroSection);
}

// ── Process File ──
async function processFile(file) {
    show(loadingSection);
    DATA.name = file.name;
    $('#loadingStatus').textContent = 'Dosya okunuyor...';

    try {
        const buf = await file.arrayBuffer();
        let isZip = false;

        try {
            const zip = await JSZip.loadAsync(buf);
            isZip = true;
            $('#loadingStatus').textContent = 'Arsiv aciliyor...';

            for (const key of Object.keys(zip.files)) {
                if (!zip.files[key].dir) {
                    try { DATA.files[key] = await zip.files[key].async('string'); }
                    catch (e) { DATA.files[key] = '[ikili dosya]'; }
                }
            }

            for (const key of Object.keys(DATA.files)) {
                const lo = key.toLowerCase();
                if (lo === 'content.xml' || lo.endsWith('/content.xml')) DATA.contentXml = DATA.files[key];
                if (lo.includes('documentproperties')) DATA.propsXml = DATA.files[key];
            }
        } catch (e) { isZip = false; }

        if (!isZip) {
            const text = await file.text();
            DATA.files[file.name] = text;
            DATA.contentXml = text;
        }

        $('#loadingStatus').textContent = 'Belge hazirlaniyor...';
        await delay(200);
        render();
        show(resultSection);
    } catch (err) {
        show(errorSection);
        $('#errorMessage').textContent = 'Dosya islenmedi: ' + err.message;
    }
}

// ── Render ──
function render() {
    $('#fileName').textContent = DATA.name;
    renderPreview();
    renderProperties();
    renderRaw();
}

// ── Preview ──
function renderPreview() {
    const el = $('#previewContent');
    const xml = DATA.contentXml;

    if (!xml || !xml.trim()) {
        let combined = '';
        for (const [fn, content] of Object.entries(DATA.files)) {
            if (fn.toLowerCase().endsWith('.sgn')) continue;
            combined += extractText(content);
        }
        el.innerHTML = combined || '<div class="empty-msg">Okunabilir icerik bulunamadi.</div>';
        DATA.allText = el.innerText;
        return;
    }

    let html = '';

    // Try XML parse
    try {
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        if (!doc.querySelector('parsererror')) {
            html = parseUYAP(doc) || parseLeaves(doc) || parseTextNodes(doc);
        }
    } catch (e) { /* ignore */ }

    // Fallback: regex
    if (!html) html = extractText(xml);

    // Fallback: strip tags
    if (!html) {
        const stripped = xml.replace(/<[^>]+>/g, '\n')
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0)
            .map(l => '<p>' + esc(l) + '</p>')
            .join('');
        html = stripped || '<div class="empty-msg">Icerik cikarilmadi</div>';
    }

    el.innerHTML = html;
    DATA.allText = el.innerText;
}

function parseUYAP(doc) {
    const tags = ['paragraph', 'Paragraph', 'PARAGRAPH', 'para', 'Para'];
    let nodes = null;
    for (const t of tags) {
        const found = doc.querySelectorAll(t);
        if (found.length > 0) { nodes = found; break; }
    }
    if (!nodes) return '';

    let html = '';
    nodes.forEach(p => {
        let text = collectText(p);
        if (!text) { html += '<br>'; return; }

        const bold = p.getAttribute('bold') === 'true' || p.getAttribute('Bold') === 'True';
        const align = p.getAttribute('alignment') || p.getAttribute('align') || p.getAttribute('Alignment') || '';
        let style = '';
        if (/center|1|orta/i.test(align)) style = 'text-align:center;';
        else if (/right|2/i.test(align)) style = 'text-align:right;';

        if (bold) html += '<h3 style="' + style + '">' + esc(text) + '</h3>';
        else html += '<p style="' + style + '">' + esc(text) + '</p>';
    });
    return html;
}

function parseLeaves(doc) {
    const texts = [];
    (function walk(node) {
        if (node.children.length === 0) {
            const t = (node.textContent || '').trim();
            if (t) texts.push(t);
        } else {
            for (const c of node.children) walk(c);
        }
    })(doc.documentElement);
    return dedupMap(texts);
}

function parseTextNodes(doc) {
    const texts = [];
    const tw = document.createTreeWalker(doc.documentElement, NodeFilter.SHOW_TEXT);
    let n;
    while (n = tw.nextNode()) {
        const t = n.textContent.trim();
        if (t) texts.push(t);
    }
    return dedupMap(texts);
}

function extractText(str) {
    if (!str) return '';
    const results = [];
    let m;

    // CDATA
    const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
    while (m = cdata.exec(str)) { const t = m[1].trim(); if (t) results.push(t); }

    // Text between tags
    const between = />([^<]+)</g;
    while (m = between.exec(str)) {
        const t = m[1].trim();
        if (t && t.length > 0 && !/^[\d.]+$/.test(t) && !/^(true|false|null)$/i.test(t)) results.push(t);
    }

    // Attribute values
    const attrs = /(?:value|data|text|content)=["']([^"']{3,})["']/gi;
    while (m = attrs.exec(str)) { results.push(m[1].trim()); }

    return dedupMap(results);
}

function dedupMap(arr) {
    const seen = new Set();
    const unique = [];
    for (const t of arr) { if (!seen.has(t)) { seen.add(t); unique.push(t); } }
    if (unique.length === 0) return '';
    return unique.map(t => '<p>' + esc(t) + '</p>').join('');
}

// ── Properties ──
function renderProperties() {
    const el = $('#propertiesContent');
    const labels = {
        title: 'Baslik', subject: 'Konu', creator: 'Olusturan', author: 'Yazar',
        description: 'Aciklama', date: 'Tarih', created: 'Olusturma Tarihi',
        modified: 'Degistirilme Tarihi', category: 'Kategori', type: 'Tur',
        documenttype: 'Belge Turu', institution: 'Kurum', court: 'Mahkeme',
        caseno: 'Dosya No', esas: 'Esas No', karar: 'Karar No', name: 'Ad'
    };

    let html = '';
    html += makeRow('Dosya Adi', DATA.name);
    html += makeRow('Arsiv Icerigi', Object.keys(DATA.files).join(', ') || '-');

    if (DATA.propsXml) {
        try {
            const doc = new DOMParser().parseFromString(DATA.propsXml, 'text/xml');
            (function walk(node) {
                for (const c of node.children) {
                    const tag = c.tagName.toLowerCase();
                    const txt = c.textContent.trim();
                    if (txt && c.children.length === 0) {
                        html += makeRow(labels[tag] || tag.charAt(0).toUpperCase() + tag.slice(1), txt);
                    }
                    if (c.children.length > 0) walk(c);
                }
            })(doc.documentElement);
        } catch (e) { /* ignore */ }
    }

    el.innerHTML = html || makeRow('Bilgi', 'Belge bilgisi bulunamadi');
}

function makeRow(label, value) {
    return '<div class="prop-row"><span class="prop-label">' + esc(label) + '</span><span class="prop-value">' + esc(value) + '</span></div>';
}

// ── Raw XML ──
function renderRaw() {
    let out = '';
    for (const [name, content] of Object.entries(DATA.files)) {
        out += '====== ' + name + ' ======\n\n' + fmtXml(content) + '\n\n';
    }
    $('#rawContent').textContent = out || DATA.contentXml || 'Icerik yok';
}

function fmtXml(xml) {
    try {
        let f = '', indent = 0;
        xml.replace(/>\s*</g, '>\n<').split('\n').forEach(line => {
            const t = line.trim();
            if (!t) return;
            if (t.startsWith('</')) indent = Math.max(0, indent - 1);
            f += '  '.repeat(indent) + t + '\n';
            if (t.charAt(0) === '<' && !t.startsWith('</') && !t.startsWith('<?') && !t.endsWith('/>') && !t.includes('</')) indent++;
        });
        return f;
    } catch (e) { return xml; }
}

// ══════════════════════════════════════
//   PDF - html2canvas (Türkçe karakter desteği)
// ══════════════════════════════════════
async function downloadPdf() {
    var btn = $('#btnDownloadPdf');
    btn.disabled = true;
    btn.textContent = 'PDF oluşturuluyor...';

    try {
        // Get text content from multiple sources
        var text = '';
        var previewEl = document.getElementById('previewContent');
        if (previewEl) text = previewEl.innerText || previewEl.textContent || '';
        if (!text || text.trim().length < 5) text = DATA.allText || '';
        if (!text || text.trim().length < 5) {
            // Extract directly from XML
            var rawXml = DATA.contentXml || '';
            if (!rawXml) {
                for (var fk in DATA.files) {
                    if (!fk.toLowerCase().endsWith('.sgn')) rawXml += DATA.files[fk] + '\n';
                }
            }
            if (rawXml) {
                var extracted = [];
                var cm;
                var cdRe = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
                while (cm = cdRe.exec(rawXml)) { if (cm[1].trim()) extracted.push(cm[1].trim()); }
                var btRe = />([^<]+)</g;
                while (cm = btRe.exec(rawXml)) {
                    var ct = cm[1].trim();
                    if (ct && ct.length > 1 && !/^[\d.]+$/.test(ct) && !/^(true|false|null|none|utf-8|1\.0)$/i.test(ct)) {
                        extracted.push(ct);
                    }
                }
                var seen2 = {};
                for (var ei = 0; ei < extracted.length; ei++) {
                    if (!seen2[extracted[ei]]) { seen2[extracted[ei]] = true; text += extracted[ei] + '\n'; }
                }
            }
        }

        if (!text || text.trim().length < 3) {
            throw new Error('Belge içeriği boş - PDF oluşturulamadı.');
        }

        // Build hidden div for rendering
        var renderDiv = document.createElement('div');
        renderDiv.style.cssText = 'position:fixed;left:-9999px;top:0;width:750px;padding:50px 60px;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#111;font-size:13px;line-height:1.8;word-wrap:break-word;overflow-wrap:break-word;white-space:pre-wrap;';

        // Header
        var header = '<div style="text-align:center;border-bottom:2px solid #7c5cfc;padding-bottom:14px;margin-bottom:20px;">';
        header += '<div style="font-size:15px;font-weight:bold;color:#222;margin-bottom:4px;">' + escPdf(DATA.name.replace(/\.udf$/i, '')) + '</div>';
        header += '<div style="font-size:9px;color:#999;">UDF Okuyucu ile oluşturuldu - Binnur Harpçı için tasarlandı</div>';
        header += '</div>';

        // Content - split into paragraphs
        var lines = text.split('\n');
        var content = '';
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line) {
                content += '<p style="margin:0 0 6px;font-size:12px;line-height:1.7;color:#111;word-wrap:break-word;">' + escPdf(line) + '</p>';
            } else {
                content += '<br>';
            }
        }

        // Footer
        var footer = '<div style="margin-top:30px;padding-top:10px;border-top:1px solid #ddd;text-align:center;">';
        footer += '<div style="font-size:8px;color:#bbb;">Bu belge UDF Okuyucu tarafından otomatik olarak oluşturulmuştur.</div>';
        footer += '</div>';

        renderDiv.innerHTML = header + content + footer;
        document.body.appendChild(renderDiv);

        // Wait for font rendering
        await delay(200);

        // Capture with html2canvas
        var canvas = await html2canvas(renderDiv, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            width: 750,
            windowWidth: 750,
            logging: false
        });

        // Remove render div
        document.body.removeChild(renderDiv);

        // Create PDF from canvas
        var JsPDF;
        if (window.jspdf && window.jspdf.jsPDF) JsPDF = window.jspdf.jsPDF;
        else if (window.jsPDF) JsPDF = window.jsPDF;
        else throw new Error('jsPDF yüklenemedi.');

        var pdf = new JsPDF('p', 'mm', 'a4');
        var pageW = pdf.internal.pageSize.getWidth();
        var pageH = pdf.internal.pageSize.getHeight();

        var imgData = canvas.toDataURL('image/jpeg', 0.92);
        var imgW = pageW;
        var imgH = (canvas.height * pageW) / canvas.width;

        var yPos = 0;
        var remaining = imgH;

        // First page
        pdf.addImage(imgData, 'JPEG', 0, yPos, imgW, imgH);
        remaining -= pageH;

        // Additional pages
        while (remaining > 0) {
            pdf.addPage();
            yPos -= pageH;
            pdf.addImage(imgData, 'JPEG', 0, yPos, imgW, imgH);
            remaining -= pageH;
        }

        // Save
        var pdfName = DATA.name.replace(/\.udf$/i, '') + '.pdf';
        pdf.save(pdfName);

    } catch (err) {
        console.error('PDF hatası:', err);
        alert('PDF oluşturulamadı: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '⬇ PDF İndir';
    }
}

function escPdf(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── TXT Download ──
function downloadTxt() {
    var text = DATA.allText || $('#previewContent').innerText || '';
    var props = $('#propertiesContent').innerText;
    if (props) text = '=== BELGE BILGILERI ===\n\n' + props + '\n\n=== ICERIK ===\n\n' + text;

    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = DATA.name.replace(/\.udf$/i, '') + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
}

// ── Helpers ──
function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function collectText(node) {
    var t = '';
    for (var i = 0; i < node.childNodes.length; i++) {
        var c = node.childNodes[i];
        if (c.nodeType === 3) t += c.textContent;
        else t += collectText(c);
    }
    return t.trim();
}
function delay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
