import "server-only";

import { zip } from "@/lib/inventory/zip";

/**
 * A Word (.docx) file with a letterhead and one clean table — written
 * directly as Office Open XML and zipped here, so the export needs no new
 * package. A4 landscape; the letterhead (logo, company, title, range,
 * generated time) is the page header and repeats on every page; the table's
 * header row repeats too; the footer carries "Page X of Y".
 */

// ── WordprocessingML ────────────────────────────────────────────────────

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // characters XML 1.0 can't carry
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

const NAVY = "1B2F6B";
const RULE = "CBD2DC";
const HEAD = "EEF2F8";

function run(text: string, o: { bold?: boolean; size?: number; color?: string } = {}) {
  const rpr = `<w:rPr>${o.bold ? "<w:b/>" : ""}${o.color ? `<w:color w:val="${o.color}"/>` : ""}${o.size ? `<w:sz w:val="${o.size}"/><w:szCs w:val="${o.size}"/>` : ""}</w:rPr>`;
  return `<w:r>${rpr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function para(content: string, o: { align?: "left" | "right" | "center"; after?: number } = {}) {
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="${o.after ?? 0}"/>${o.align ? `<w:jc w:val="${o.align}"/>` : ""}</w:pPr>${content}</w:p>`;
}

export interface DocxInput {
  title: string;
  subtitle: string;
  generated: string;
  company: string;
  address: string[];
  logo: { jpeg: Buffer; aspect: number };
  summary: string[];
  head: string[];
  right: boolean[];
  rows: string[][];
  /** relative column widths */
  widths: number[];
  totalLine: string;
}

export function buildDocx(d: DocxInput): Buffer {
  // A4 landscape in twentieths of a point; 0.5" margins
  const pageW = 16838;
  const pageH = 11906;
  const margin = 720;
  const usable = pageW - margin * 2;
  const total = d.widths.reduce((a, b) => a + b, 0);
  const tw = d.widths.map((w) => Math.floor((w / total) * usable));

  const cell = (text: string, w: number, o: { head?: boolean; right?: boolean; shade?: string }) =>
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>` : ""}<w:vAlign w:val="center"/></w:tcPr>` +
    para(run(text, { bold: o.head, size: o.head ? 15 : 16, color: o.head ? NAVY : undefined }), { align: o.right ? "right" : "left" }) +
    `</w:tc>`;

  const headRow =
    `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>` +
    d.head.map((h, i) => cell(h, tw[i], { head: true, right: d.right[i], shade: HEAD })).join("") +
    `</w:tr>`;
  const bodyRows = d.rows
    .map(
      (r, k) =>
        `<w:tr><w:trPr><w:cantSplit/></w:trPr>` +
        r.map((c, i) => cell(c, tw[i], { right: d.right[i], shade: k % 2 ? "F8FAFC" : undefined })).join("") +
        `</w:tr>`,
    )
    .join("");
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="${RULE}"/>`;
  const table =
    `<w:tbl><w:tblPr><w:tblW w:w="${usable}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
    `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders>` +
    `<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="70" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar>` +
    `</w:tblPr><w:tblGrid>${tw.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${headRow}${bodyRows}</w:tbl>`;

  const body =
    para(d.summary.map((s, i) => run((i ? "     " : "") + s, { size: 17 })).join(""), { after: 120 }) +
    table +
    para(run(d.totalLine, { bold: true, size: 17, color: NAVY }), { align: "right", after: 0 });

  const sect =
    `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/>` +
    `<w:pgSz w:w="${pageW}" w:h="${pageH}" w:orient="landscape"/>` +
    `<w:pgMar w:top="1900" w:right="${margin}" w:bottom="900" w:left="${margin}" w:header="420" w:footer="380" w:gutter="0"/></w:sectPr>`;

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;

  // letterhead: logo + address on the left, title block on the right
  const cy = 420000; // ≈ 1.17 cm high
  const cx = Math.round(cy * d.logo.aspect);
  const logo =
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Logo"/>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="logo.jpeg"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  const half = Math.floor(usable / 2);
  const noBorders = `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((x) => `<w:${x} w:val="nil"/>`).join("")}</w:tblBorders>`;
  const header =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}>` +
    `<w:tbl><w:tblPr><w:tblW w:w="${usable}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${noBorders}</w:tblPr><w:tblGrid><w:gridCol w:w="${half}"/><w:gridCol w:w="${usable - half}"/></w:tblGrid><w:tr>` +
    `<w:tc><w:tcPr><w:tcW w:w="${half}" w:type="dxa"/><w:tcBorders><w:bottom w:val="single" w:sz="12" w:space="0" w:color="${NAVY}"/></w:tcBorders></w:tcPr>` +
    para(logo) +
    d.address.map((a) => para(run(a, { size: 14 }))).join("") +
    `</w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="${usable - half}" w:type="dxa"/><w:tcBorders><w:bottom w:val="single" w:sz="12" w:space="0" w:color="${NAVY}"/></w:tcBorders><w:vAlign w:val="bottom"/></w:tcPr>` +
    para(run(d.title, { bold: true, size: 26, color: NAVY }), { align: "right" }) +
    para(run(d.subtitle, { size: 17 }), { align: "right" }) +
    para(run("Generated: ", { size: 15, color: "555555" }) + run(d.generated, { size: 15 }), { align: "right", after: 80 }) +
    `</w:tc></w:tr></w:tbl><w:p/></w:hdr>`;

  const field = (instr: string) =>
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const footer =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}>` +
    `<w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="${RULE}"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="${usable}"/></w:tabs></w:pPr>` +
    run(`${d.company} · Product Specification`, { size: 15 }) +
    `<w:r><w:tab/></w:r>` +
    run("Page ", { size: 15 }) + field("PAGE") + run(" of ", { size: 15 }) + field("NUMPAGES") +
    `</w:p></w:ftr>`;

  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:lang w:val="en-IN"/></w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>` +
    `<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `</Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
    `</Relationships>`;
  const docRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>` +
    `<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>` +
    `</Relationships>`;
  const headerRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.jpeg"/>` +
    `</Relationships>`;
  const core =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${esc(d.title)} · ${esc(d.subtitle)}</dc:title><dc:creator>${esc(d.company)}</dc:creator></cp:coreProperties>`;

  return zip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rels },
    { name: "docProps/core.xml", data: core },
    { name: "word/document.xml", data: document },
    { name: "word/styles.xml", data: styles },
    { name: "word/header1.xml", data: header },
    { name: "word/footer1.xml", data: footer },
    { name: "word/_rels/document.xml.rels", data: docRels },
    { name: "word/_rels/header1.xml.rels", data: headerRels },
    { name: "word/media/logo.jpeg", data: d.logo.jpeg },
  ]);
}
