import { useEffect, useMemo, useState } from "react";
import {
  CheckOutlined,
  EyeOutlined,
  FileProtectOutlined,
  FileTextOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  WarningOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from "@ant-design/icons";
import { Alert, Button, InputNumber, Modal, Segmented, Slider, Space, Spin, Tag } from "antd";

import type { Translate } from "../../i18n";
import type { SignatureAsset, SignatureUsage } from "../wht/types";

interface SignaturePreviewModalProps {
  signature: SignatureAsset | null;
  open: boolean;
  t: Translate;
  onClose: () => void;
  onSaveScale?: (signatureId: string, scalePercent: number) => Promise<void> | void;
}

const usageColors: Record<SignatureUsage, string> = {
  wht: "cyan",
  tax_inv: "blue",
  salary_advance: "purple",
  salary_advance_finance: "purple",
  salary_advance_md: "magenta",
};

/**
 * 三份底版的 mediabox 都是 A4 且原点在 (0,0)、无 CropBox 偏移、无 /Rotate
 * （2026-08-05 用 pypdf 实测三份 templates/*.pdf 确认）。底图 PNG 是整页
 * 150 DPI 渲染（1241x1754），所以「PDF 点 / 页面尺寸」就是底图上的百分比位置。
 */
const PAGE_WIDTH_PT = 595.25;
const PAGE_HEIGHT_PT = 841.85;

interface SignatureBoxPt {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 签名框，单位一律是 **PDF 点**，数值逐字抄自后端，不在这里换算成百分比。
 *
 * 以前这张表存的是相对底图的百分比。同一份坐标存在两个地方、两种单位，就一定会
 * 漂——2026-08-04 工资预支底版重制四轮，leftPercent 跟着更新了、bottomPercent 忘了，
 * 预览比实际出票低了 12.9pt，而两边都不报错。改成和后端同一个单位之后，
 * tests/test_signature_preview_alignment.py 是逐字比对而不是"换算完再比"，
 * 抄错一位就是一条红测试。
 *
 * 改这张表 = 改后端坐标，两边必须同一次提交。
 */
const SIGNATURE_BOXES_PT: Record<SignatureUsage, SignatureBoxPt> = {
  // backend/app/modules/wht/document_generator.py :: PDF_SIGNATURE_BOX
  wht: { x: 201.5, y: 83.0, width: 95.0, height: 42.0 },
  // backend/app/modules/tax_invoice/document_generator.py :: SIGNATURE_BOX
  tax_inv: { x: 398.0, y: 112.0, width: 150.0, height: 46.0 },
  // backend/app/modules/salary_advance/pdf_layout.py :: SIGNATURE_BOXES["finance"]
  salary_advance: { x: 294.88, y: 304.91, width: 90.0, height: 28.0 },
  salary_advance_finance: { x: 294.88, y: 304.91, width: 90.0, height: 28.0 },
  // backend/app/modules/salary_advance/pdf_layout.py :: SIGNATURE_BOXES["md"]
  salary_advance_md: { x: 294.82, y: 201.96, width: 90.0, height: 28.0 },
};

type TemplateTab = "wht" | "tax_inv" | "salary_advance";

interface TemplateConfig {
  /**
   * 底图 = 后端生成器真出的那一页（彩色、填了样例数据、未盖章），
   * 由 scripts/build_signature_preview_backgrounds.py 渲染。
   * 彩色是必需的：TAX INV 与工资预支底版左上角是公司 logo，出票就是彩的。
   */
  bgImage: string;
  title: string;
  /** 这张底版上的签名位。工资预支单一页两个位（财务负责人 + 董事/总经理）。 */
  stamps: { usage: SignatureUsage; label: string }[];
}

const TEMPLATE_CONFIGS: Record<TemplateTab, TemplateConfig> = {
  wht: {
    bgImage: "/wht-template-bg.webp",
    title: "WHT 扣缴凭证 (P.N.D.53/3 正式文件底板)",
    stamps: [{ usage: "wht", label: "ผู้จ่ายเงิน 付款方签名" }],
  },
  tax_inv: {
    bgImage: "/tax-inv-template-bg.webp",
    title: "TAX INV 增值税发票 (正式文件底板)",
    stamps: [{ usage: "tax_inv", label: "ผู้มีอำนาจลงนาม 授权签字人" }],
  },
  salary_advance: {
    bgImage: "/salary-advance-template-bg.webp",
    title: "工资预支单凭证 (财务负责人 + 董事/总经理签名位置)",
    stamps: [
      { usage: "salary_advance_finance", label: "财务负责人 Finance Director" },
      { usage: "salary_advance_md", label: "董事/总经理 Managing Director" },
    ],
  },
};

/**
 * 按缩放比算出这一次实际盖章的矩形，**围绕签名框中心缩放**。
 *
 * 这一段是后端三处 drawImage 之前那四行的逐字翻译：
 *   scaled_x = x + (width - width * ratio) / 2
 * 以前预览是钉住左下角只改宽高，滑块一动落点就跟出票分家：WHT 拉到 60% 时
 * 预览的签名比实际出票左 19pt、低 8.4pt，而调的人正是照着预览在调。
 */
export function stampRectPt(box: SignatureBoxPt, scalePercent: number): SignatureBoxPt {
  const ratio = (scalePercent || 100) / 100;
  const width = box.width * ratio;
  const height = box.height * ratio;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

/** PDF 点 -> 底图容器上的 CSS 百分比。容器宽高就是整页，所以是纯除法。 */
function boxToCssPercent(rect: SignatureBoxPt) {
  return {
    left: `${(rect.x / PAGE_WIDTH_PT) * 100}%`,
    bottom: `${(rect.y / PAGE_HEIGHT_PT) * 100}%`,
    width: `${(rect.width / PAGE_WIDTH_PT) * 100}%`,
    height: `${(rect.height / PAGE_HEIGHT_PT) * 100}%`,
  };
}

/**
 * 生成默认的演示签名 SVG Data URL (当无法读取服务端真实图片时作为优雅降级)
 */
function createDemoSignatureDataUrl(name: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120" viewBox="0 0 300 120">
    <rect width="100%" height="100%" fill="none"/>
    <path d="M 30 75 Q 60 20 90 65 T 150 45 T 210 70 T 270 35" stroke="#1d2939" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <path d="M 45 85 C 80 95, 160 90, 255 80" stroke="#8c6b3e" stroke-width="2" fill="none" stroke-dasharray="4,2"/>
    <text x="150" y="108" font-family="'Cormorant Garamond', 'Noto Serif SC', serif" font-size="16" font-style="italic" font-weight="600" fill="#475467" text-anchor="middle">${name}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * 扫描用的最长边上限。逐像素扫描跑在主线程上，签名上传只校验格式不校验尺寸
 * （wht.document_generator.validate_signature_image），手机拍的一张 4000x3000
 * 就是 1200 万次循环，弹窗会肉眼可见地卡住。
 *
 * 缩到这个尺寸再扫是安全的：决定落点的只有**墨迹外接框的长宽比**（外层用
 * object-fit: contain 等比适配），等比缩放不改变它；预览里这张图最宽也就 480px，
 * 缩到 1200 连观感都不掉。缩放只影响预览，不影响出票——出票是后端按原图算的。
 */
const INK_SCAN_MAX_EDGE = 1200;

/**
 * 浏览器里复刻 wht.document_generator.build_blue_signature：
 * 剔除近白像素与扫描件下划线、转成蓝色墨水、裁到墨迹外接框（留 2px）。
 *
 * 为什么非做不可：出票时进 drawImage 的是**裁过的**图，预览如果直接贴原图，
 * 一张四周有留白的签名（导出的 PNG 基本都是这样）在预览里只占框的一小块，
 * 出票却是撑满整框。用户照着预览把比例调大，实际印出来就大得离谱。
 */
function prepareBlueInk(image: HTMLImageElement): string {
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) {
    throw new Error("签名图片尺寸为 0，无法计算墨迹范围");
  }
  const shrink = Math.min(
    1,
    INK_SCAN_MAX_EDGE / Math.max(naturalWidth, naturalHeight),
  );
  const width = Math.max(1, Math.round(naturalWidth * shrink));
  const height = Math.max(1, Math.round(naturalHeight * shrink));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("当前浏览器不支持 canvas 2d，无法复刻出票时的裁剪");
  }
  context.drawImage(image, 0, 0, width, height);
  const source = context.getImageData(0, 0, width, height);
  const pixels = source.data;

  const isInk = (index: number): boolean => {
    const offset = index * 4;
    return (
      pixels[offset + 3] > 0 &&
      !(pixels[offset] >= 245 && pixels[offset + 1] >= 245 && pixels[offset + 2] >= 245)
    );
  };

  // 扫描件常见的签名下划线：横跨至少 45% 宽度的连续墨迹整段剔除。
  const minimumRuleWidth = Math.max(24, Math.floor(width * 0.45));
  const removed = new Set<number>();
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width;
    let runStart: number | null = null;
    for (let x = 0; x <= width; x += 1) {
      const occupied = x < width && isInk(rowStart + x);
      if (occupied && runStart === null) {
        runStart = x;
      }
      if (occupied || runStart === null) {
        continue;
      }
      if (x - runStart >= minimumRuleWidth) {
        for (let cursor = rowStart + runStart; cursor < rowStart + x; cursor += 1) {
          removed.add(cursor);
        }
      }
      runStart = null;
    }
  }

  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    if (removed.has(index) || !isInk(index)) {
      pixels[offset + 3] = 0;
      continue;
    }
    const luminance = Math.floor(
      (299 * pixels[offset] + 587 * pixels[offset + 1] + 114 * pixels[offset + 2]) / 1000,
    );
    const strength = 255 - luminance;
    if (strength < 14) {
      pixels[offset + 3] = 0;
      continue;
    }
    pixels[offset] = 20;
    pixels[offset + 1] = 70;
    pixels[offset + 2] = Math.min(255, 210 + Math.floor((strength / 255) * 25));
    pixels[offset + 3] = Math.max(pixels[offset + 3], Math.min(255, Math.floor(strength * 1.7)));
    const x = index % width;
    const y = Math.floor(index / width);
    if (x < left) left = x;
    if (x >= right) right = x + 1;
    if (y < top) top = y;
    if (y >= bottom) bottom = y + 1;
  }
  if (right <= left || bottom <= top) {
    throw new Error("这张签名图片里没有可用的墨迹，出票时同样会被拒绝");
  }
  context.putImageData(source, 0, 0);

  const padding = 2;
  const cropLeft = Math.max(0, left - padding);
  const cropTop = Math.max(0, top - padding);
  const cropRight = Math.min(width, right + padding);
  const cropBottom = Math.min(height, bottom + padding);
  const cropped = document.createElement("canvas");
  cropped.width = cropRight - cropLeft;
  cropped.height = cropBottom - cropTop;
  const croppedContext = cropped.getContext("2d");
  if (!croppedContext) {
    throw new Error("当前浏览器不支持 canvas 2d，无法复刻出票时的裁剪");
  }
  croppedContext.drawImage(
    canvas,
    cropLeft,
    cropTop,
    cropped.width,
    cropped.height,
    0,
    0,
    cropped.width,
    cropped.height,
  );
  return cropped.toDataURL("image/png");
}

type InkState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; dataUrl: string }
  | { status: "failed"; reason: string };

/**
 * 预加载并按出票口径处理签名图。失败不静默——预览是用户唯一能看见落位的地方，
 * 悄悄退回原图会让他照着一张假图去调比例。
 */
function usePreparedInk(src: string | null, enabled: boolean): InkState {
  const [state, setState] = useState<InkState>({ status: "idle" });

  useEffect(() => {
    if (!src || !enabled) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      try {
        setState({ status: "ready", dataUrl: prepareBlueInk(image) });
      } catch (error) {
        setState({
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    };
    image.onerror = () => {
      if (cancelled) return;
      setState({ status: "failed", reason: "签名图片加载失败，无法计算出票时的墨迹范围" });
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, enabled]);

  return state;
}

export function SignaturePreviewModal({
  signature,
  open,
  t,
  onClose,
  onSaveScale,
}: SignaturePreviewModalProps) {
  const [activeTemplate, setActiveTemplate] = useState<TemplateTab>("wht");
  const [scalePercent, setScalePercent] = useState<number>(100);
  const [templateZoom, setTemplateZoom] = useState<number>(100);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    if (signature) {
      setScalePercent(signature.scalePercent ?? 100);
    }
  }, [signature, open]);

  const isDemo =
    import.meta.env.VITE_USE_MOCK_API === "true" || Boolean(signature?.sha256.startsWith("demo"));
  const signatureSrc = signature
    ? isDemo
      ? createDemoSignatureDataUrl(signature.name)
      : `/api/v1/wht/signatures/${signature.id}/content`
    : null;

  // 蓝笔化+裁剪只跟签名图有关，与当前看哪张底版、拖到多少比例无关，算一次即可。
  // 三个单据现在走同一份 core.signature_image，所以这里也只有一种处理。
  const ink = usePreparedInk(signatureSrc, open);

  const templateOptions = useMemo(
    () => [
      {
        label: (
          <Space size={4}>
            <FileProtectOutlined />
            <span>WHT 扣缴凭证 (P.N.D.53/3)</span>
          </Space>
        ),
        value: "wht",
      },
      {
        label: (
          <Space size={4}>
            <FileTextOutlined />
            <span>TAX INV 增值税发票</span>
          </Space>
        ),
        value: "tax_inv",
      },
      {
        label: (
          <Space size={4}>
            <SafetyCertificateOutlined />
            <span>工资预支单凭证</span>
          </Space>
        ),
        value: "salary_advance",
      },
    ],
    [],
  );

  if (!signature) return null;

  const handleConfirmSave = async () => {
    if (!onSaveScale) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await onSaveScale(signature.id, scalePercent);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const currentCfg = TEMPLATE_CONFIGS[activeTemplate];
  // 出票时进 drawImage 的就是这张裁过的蓝墨图，三个单据都一样。
  const stampSrc = ink.status === "ready" ? ink.dataUrl : null;

  return (
    <Modal
      style={{ top: 20 }}
      styles={{ body: { padding: "10px 16px" } }}
      destroyOnClose
      footer={
        <div className="signature-preview-footer">
          <div className="footer-left">
            <Button
              icon={<ReloadOutlined />}
              size="small"
              onClick={() => setScalePercent(100)}
            >
              还原默认尺寸 (100%)
            </Button>
          </div>
          <div className="footer-right">
            <Button onClick={onClose}>{t("common.cancel")}</Button>
            <Button
              icon={<CheckOutlined />}
              loading={saving}
              type="primary"
              onClick={() => void handleConfirmSave()}
            >
              确认应用签名尺寸到系统开票
            </Button>
          </div>
        </div>
      }
      open={open}
      title={
        <div className="signature-preview-modal-header">
          <div className="title-row">
            <EyeOutlined className="header-icon" />
            <h2>{t("wht.signaturePreviewTitle") || "签名效果与尺寸预览"}</h2>
            <Tag color={signature.status === "active" ? "green" : "default"}>
              {signature.status === "active" ? t("wht.enabled") : t("wht.disabled")}
            </Tag>
            {signature.isDefault && (
              <Tag color="gold">{t("wht.defaultSignature")}</Tag>
            )}
          </div>
          <p className="subtitle">
            {signature.name} (v{signature.version}) · {signature.originalFileName}
          </p>
        </div>
      }
      width={960}
      onCancel={onClose}
    >
      <div className="signature-preview-container">
        {/* 左侧：签名原图与实时缩放控制 */}
        <div className="signature-source-panel">
          <div className="panel-title">
            <EyeOutlined />
            <span>导入的签名图片 (Source Image)</span>
          </div>

          <div className="signature-image-wrapper">
            {signatureSrc && (
              <img
                alt={signature.name}
                className="source-signature-img"
                src={signatureSrc}
              />
            )}
          </div>

          {/* 交互式签名大小调节器 */}
          <div className="signature-scale-control-card">
            <div className="control-header">
              <ZoomInOutlined />
              <strong>调节签名大小 (Scale Control)</strong>
            </div>
            <div className="scale-slider-row">
              <Slider
                max={200}
                min={50}
                step={5}
                style={{ flex: 1 }}
                value={scalePercent}
                onChange={setScalePercent}
              />
              <InputNumber
                addonAfter="%"
                max={200}
                min={50}
                style={{ width: 85 }}
                value={scalePercent}
                onChange={(val) => val && setScalePercent(val)}
              />
            </div>
            <div className="preset-buttons">
              <Button size="small" onClick={() => setScalePercent(80)}>
                80%
              </Button>
              <Button size="small" onClick={() => setScalePercent(100)}>
                100% (默认)
              </Button>
              <Button size="small" onClick={() => setScalePercent(120)}>
                120%
              </Button>
              <Button size="small" onClick={() => setScalePercent(150)}>
                150%
              </Button>
            </div>
            <small className="scale-hint">
              右侧使用系统开票正式文件底板（如 WHT/TAX INV/工资单），拖动滑块实时定位缩放签名套印效果。
              缩放围绕签名框中心进行，与后端 ReportLab 出票口径一致。
            </small>
          </div>

          <div className="source-meta-card">
            <div className="meta-item">
              <span className="meta-label">签名名称</span>
              <span className="meta-val">{signature.name}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">适用范围</span>
              <div className="meta-val tags-val">
                {signature.usage.map((mod) => (
                  <Tag color={usageColors[mod]} key={mod}>
                    {t(`wht.usage.${mod}` as Parameters<typeof t>[0])}
                  </Tag>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 右侧：基于系统真实开票文件底图的套印预览 */}
        <div className="signature-template-panel">
          <div className="panel-title">
            <FileProtectOutlined />
            <span>系统真实开票文件底板套印预览 (System PDF Template Preview)</span>
          </div>

          <div className="template-toolbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <Segmented
              className="template-segmented"
              options={templateOptions}
              value={activeTemplate}
              onChange={(val) => setActiveTemplate(val as TemplateTab)}
            />
            <div className="template-zoom-controls" style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Button
                size="small"
                icon={<ZoomOutOutlined />}
                disabled={templateZoom <= 60}
                onClick={() => setTemplateZoom((z) => Math.max(60, z - 20))}
                title="缩小底板模板"
              />
              <span style={{ fontSize: 12, fontWeight: 600, color: "#475467", minWidth: 42, textAlign: "center", display: "inline-block" }}>
                {templateZoom}%
              </span>
              <Button
                size="small"
                icon={<ZoomInOutlined />}
                disabled={templateZoom >= 200}
                onClick={() => setTemplateZoom((z) => Math.min(200, z + 20))}
                title="放大底板模板"
              />
              {templateZoom !== 100 && (
                <Button
                  size="small"
                  type="text"
                  style={{ padding: "0 4px", fontSize: 11, color: "#8c6b3e" }}
                  onClick={() => setTemplateZoom(100)}
                >
                  重置
                </Button>
              )}
            </div>
          </div>

          {ink.status === "failed" && (
            <Alert
              className="signature-preview-alert"
              description={`${ink.reason}。这里显示的是未经处理的原图位置，与实际出票会有出入，请勿据此调整比例。`}
              icon={<WarningOutlined />}
              message="无法按出票口径处理签名图"
              showIcon
              type="error"
            />
          )}

          {/* 底图就是后端真出的那一页（彩色、带样例数据、未盖章），
              支持通过 templateZoom 实时按 60%~200% 等比放大/缩小模版视口 */}
          <div className="pdf-template-underlay-viewport">
            <div
              className="pdf-page-container"
              style={{
                width: `${Math.round(380 * (templateZoom / 100))}px`,
                minWidth: `${Math.round(380 * (templateZoom / 100))}px`,
                maxWidth: "none",
                flexShrink: 0,
                transition: "width 0.15s ease, min-width 0.15s ease",
              }}
            >
              <img
                alt={currentCfg.title}
                className="pdf-underlay-image"
                src={currentCfg.bgImage}
              />

              {/* 核心套印签名图层：坐标、居中缩放、等比适配三项都与后端 drawImage 同源 */}
              {currentCfg.stamps.map(({ usage, label }) => {
                const rect = stampRectPt(SIGNATURE_BOXES_PT[usage], scalePercent);
                // 这张签名没勾这个位置，出票时不会盖在这儿，画个空框说明为什么。
                const applies = signature.usage.includes(usage);
                return (
                  <div
                    className={
                      applies
                        ? "exact-signature-overlay-box"
                        : "exact-signature-overlay-box is-not-applicable"
                    }
                    data-testid={`signature-stamp-${usage}`}
                    key={usage}
                    style={boxToCssPercent(rect)}
                    title={label}
                  >
                    {applies && stampSrc && <img alt={`${signature.name} — ${label}`} src={stampSrc} />}
                    {applies && !stampSrc && <Spin size="small" />}
                    {!applies && <span className="not-applicable-hint">未勾选此签名位</span>}
                  </div>
                );
              })}
            </div>
          </div>

          <small className="template-fidelity-note">
            出票前会先剔除近白背景与扫描下划线、裁到墨迹外接框并转为蓝色墨水，
            三种单据口径一致，此处按同一口径渲染。
          </small>
        </div>
      </div>
    </Modal>
  );
}
