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
//   PDF - Pure jsPDF (no html2canvas)
// ══════════════════════════════════════
function downloadPdf() {
    var btn = $('#btnDownloadPdf');
    btn.disabled = true;
    btn.textContent = 'PDF olusturuluyor...';

    try {
        var jsPDF = window.jspdf.jsPDF;
        var doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

        var pageW = doc.internal.pageSize.getWidth();   // 210
        var pageH = doc.internal.pageSize.getHeight();  // 297
        var marginL = 20;
        var marginR = 20;
        var marginT = 25;
        var marginB = 20;
        var usableW = pageW - marginL - marginR;        // 170
        var y = marginT;
        var lineH = 6; // mm per line

        // ── Header ──
        doc.setDrawColor(124, 92, 252);
        doc.setLineWidth(0.5);
        doc.line(marginL, y, pageW - marginR, y);
        y += 6;

        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(DATA.name.replace(/\.udf$/i, ''), pageW / 2, y, { align: 'center' });
        y += 6;

        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(150, 150, 150);
        doc.text('UDF Okuyucu ile olusturuldu - Binnur Harpci icin tasarlandi', pageW / 2, y, { align: 'center' });
        y += 4;

        doc.setDrawColor(124, 92, 252);
        doc.line(marginL, y, pageW - marginR, y);
        y += 10;

        // ── Content ──
        doc.setTextColor(30, 30, 30);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');

        // Get the text content
        var text = DATA.allText || $('#previewContent').innerText || '';

        // Split into lines that fit the page width
        var allLines = [];
        var paragraphs = text.split('\n');

        for (var pi = 0; pi < paragraphs.length; pi++) {
            var para = paragraphs[pi].trim();
            if (para === '') {
                allLines.push('');
                continue;
            }
            // Split long lines to fit within usable width
            var wrapped = doc.splitTextToSize(para, usableW);
            for (var wi = 0; wi < wrapped.length; wi++) {
                allLines.push(wrapped[wi]);
            }
        }

        // Write lines, handle page breaks
        for (var i = 0; i < allLines.length; i++) {
            if (y + lineH > pageH - marginB) {
                // Footer on current page
                addPageFooter(doc, pageW, pageH, marginL, marginR);
                doc.addPage();
                y = marginT;
            }

            var line = allLines[i];
            if (line === '') {
                y += lineH * 0.5; // smaller gap for empty lines
            } else {
                doc.text(line, marginL, y);
                y += lineH;
            }
        }

        // ── Footer on last page ──
        addPageFooter(doc, pageW, pageH, marginL, marginR);

        // ── Add page numbers ──
        var totalPages = doc.internal.getNumberOfPages();
        for (var p = 1; p <= totalPages; p++) {
            doc.setPage(p);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(180, 180, 180);
            doc.text('Sayfa ' + p + ' / ' + totalPages, pageW / 2, pageH - 8, { align: 'center' });
        }

        // Save
        var pdfName = DATA.name.replace(/\.udf$/i, '') + '.pdf';
        doc.save(pdfName);
        alert('PDF basariyla indirildi: ' + pdfName);

    } catch (err) {
        console.error('PDF hatasi:', err);
        alert('PDF olusturulamadi: ' + err.message + '\n\nDetay: ' + err.stack);
    } finally {
        btn.disabled = false;
        btn.textContent = 'PDF Indir';
    }
}

function addPageFooter(doc, pageW, pageH, marginL, marginR) {
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.2);
    doc.line(marginL, pageH - 15, pageW - marginR, pageH - 15);
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
