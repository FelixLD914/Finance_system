import { useEffect, useState } from "react";
import {
  CheckOutlined,
  EyeOutlined,
  FileProtectOutlined,
  FileTextOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ZoomInOutlined,
} from "@ant-design/icons";
import { Button, InputNumber, Modal, Segmented, Slider, Space, Tag } from "antd";

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
};

/**
 * 对应真实系统 PDF 开票模板底图的参数配置 (A4 页面比例 595.28 x 841.89 pt)
 * 结合 backend/app/modules 各自的 SIGNATURE_BOX 坐标进行百分比定位，确保预览效果与后端 ReportLab 开票生成的 PDF 完全一致。
 */
const TEMPLATE_CONFIGS: Record<
  SignatureUsage,
  {
    bgImage: string;
    title: string;
    // PDF 签名框在底板上的百分比坐标与基准宽高 (%)
    sigBox: {
      leftPercent: number; // 签名中心在底图中的 X 轴百分比
      bottomPercent: number; // 签名中心在底图中的 Y 轴 (从底部算) 百分比
      widthPercent: number; // 基准 100% 时的宽度百分比
      heightPercent: number; // 基准 100% 时的高度百分比
    };
  }
> = {
  wht: {
    bgImage: "/wht-template-bg.png",
    title: "WHT 扣缴凭证 (P.N.D.53/3 正式文件底板)",
    // ReportLab WHT 坐标: (201.5, 83.0, 95.0, 42.0) -> 中心 X = 201.5 + 47.5 = 249.0 (41.83%), Y = 83.0 + 21 = 104.0 (12.35%)
    sigBox: {
      leftPercent: 41.83,
      bottomPercent: 12.35,
      widthPercent: 18.5,
      heightPercent: 5.8,
    },
  },
  tax_inv: {
    bgImage: "/tax-inv-template-bg.png",
    title: "TAX INV 增值税发票 (正式文件底板)",
    // ReportLab TAX INV 坐标: (398.0, 112.0, 150.0, 46.0) -> 中心 X = 398.0 + 75.0 = 473.0 (79.46%), Y = 112.0 + 23.0 = 135.0 (16.03%)
    sigBox: {
      leftPercent: 79.46,
      bottomPercent: 16.03,
      widthPercent: 25.2,
      heightPercent: 6.2,
    },
  },
  salary_advance: {
    bgImage: "/salary-advance-template-bg.png",
    title: "工资预支单凭证 (正式文件底板)",
    // ReportLab Salary Advance 坐标: (328.37, 286.31, 90.0, 28.0) -> 中心 X = 328.37 + 45 = 373.37 (62.72%), Y = 286.31 + 14 = 300.31 (35.67%)
    sigBox: {
      leftPercent: 62.72,
      bottomPercent: 35.67,
      widthPercent: 18.0,
      heightPercent: 4.8,
    },
  },
};

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

export function SignaturePreviewModal({
  signature,
  open,
  t,
  onClose,
  onSaveScale,
}: SignaturePreviewModalProps) {
  const [activeTemplate, setActiveTemplate] = useState<SignatureUsage>("wht");
  const [scalePercent, setScalePercent] = useState<number>(100);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    if (signature) {
      setScalePercent(signature.scalePercent ?? 100);
    }
  }, [signature, open]);

  if (!signature) return null;

  const isDemo = import.meta.env.VITE_USE_MOCK_API === "true" || signature.sha256.startsWith("demo");
  const signatureSrc = isDemo
    ? createDemoSignatureDataUrl(signature.name)
    : `/api/v1/wht/signatures/${signature.id}/content`;

  const templateOptions = [
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
  ];

  const handleConfirmSave = async () => {
    if (!signature || !onSaveScale) {
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
  const scaleRatio = scalePercent / 100;

  return (
    <Modal
      centered
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
            <img
              alt={signature.name}
              className="source-signature-img"
              src={signatureSrc}
            />
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

          <div className="template-toolbar">
            <Segmented
              className="template-segmented"
              options={templateOptions}
              value={activeTemplate}
              onChange={(val) => setActiveTemplate(val as SignatureUsage)}
            />
          </div>

          {/* 真实系统 PDF 模板底图 + 精确 ReportLab 坐标叠加渲染 */}
          <div className="pdf-template-underlay-viewport">
            <div className="pdf-page-container">
              <img
                alt={currentCfg.title}
                className="pdf-underlay-image"
                src={currentCfg.bgImage}
              />

              {/* 在系统真实文件底板上叠加开票样例文字 (位置与 ReportLab 生成 PDF 完全对齐) */}
              {activeTemplate === "wht" && (
                <div className="overlay-sample-layer wht-sample-layer">
                  <span className="pdf-field val-bookno" style={{ left: "75%", top: "4.5%" }}>202607BK1</span>
                  <span className="pdf-field val-refno" style={{ left: "75%", top: "6.2%" }}>ZWT202607001</span>
                  <span className="pdf-field val-payee" style={{ left: "10%", top: "21.0%" }}>บริษัท จั่วป่าร์รีไซเคิลสหวรุ่งเรือง จำกัด</span>
                  <span className="pdf-field val-taxid" style={{ left: "80%", top: "21.1%" }}>0105540057561</span>
                  <span className="pdf-field val-incometype" style={{ left: "30%", top: "69.5%" }}>ค่าบริการ (Services)</span>
                  <span className="pdf-field val-date" style={{ left: "62%", top: "69.5%" }}>2026/7/3</span>
                  <span className="pdf-field val-amount" style={{ left: "78%", top: "69.5%" }}>150,000.00</span>
                  <span className="pdf-field val-tax" style={{ left: "91%", top: "69.5%" }}>4,500.00</span>
                  <span className="pdf-field val-total-amount" style={{ left: "78%", top: "73.2%" }}>150,000.00</span>
                  <span className="pdf-field val-total-tax" style={{ left: "91%", top: "73.2%" }}>4,500.00</span>
                  <span className="pdf-field val-bahttext" style={{ left: "45%", top: "76.5%" }}>-- หนึ่งแสนห้าหมื่นบาทถ้วน --</span>
                  <span className="pdf-field val-date-thai" style={{ left: "38%", top: "90.8%" }}>3 กรกฎาคม 2569</span>
                </div>
              )}

              {activeTemplate === "tax_inv" && (
                <div className="overlay-sample-layer tax-inv-sample-layer">
                  <span className="pdf-field val-invno" style={{ left: "80%", top: "12.0%" }}>INV202607089</span>
                  <span className="pdf-field val-invdate" style={{ left: "80%", top: "13.8%" }}>2026-07-15</span>
                  <span className="pdf-field val-customer" style={{ left: "18%", top: "21.5%" }}>SIAM LOGISTICS GROUP CO., LTD.</span>
                  <span className="pdf-field val-declno" style={{ left: "18%", top: "24.0%" }}>A019-06907-00381</span>
                  <span className="pdf-field val-itemdesc" style={{ left: "12%", top: "35.5%" }}>EXPORT FREIGHT SERVICES</span>
                  <span className="pdf-field val-itemfob" style={{ left: "65%", top: "35.5%" }}>480,000.00</span>
                  <span className="pdf-field val-itemvat" style={{ left: "78%", top: "35.5%" }}>33,600.00</span>
                  <span className="pdf-field val-itemtotal" style={{ left: "90%", top: "35.5%" }}>513,600.00</span>
                </div>
              )}

              {activeTemplate === "salary_advance" && (
                <div className="overlay-sample-layer salary-advance-sample-layer">
                  <span className="pdf-field val-batchno" style={{ left: "75%", top: "8.5%" }}>SA20260701</span>
                  <span className="pdf-field val-empname" style={{ left: "20%", top: "18.5%" }}>Somchai Jaidee (EMP08821)</span>
                  <span className="pdf-field val-dept" style={{ left: "20%", top: "21.5%" }}>Logistics Operations Dept</span>
                  <span className="pdf-field val-advamt" style={{ left: "20%", top: "32.0%" }}>25,000.00 THB</span>
                  <span className="pdf-field val-repay" style={{ left: "55%", top: "32.0%" }}>2026-08 (次月扣还)</span>
                </div>
              )}

              {/* 核心套印签名图层：基于 ReportLab 官方坐标百分比与动态 scalePercent 精准定位 */}
              <div
                className="exact-signature-overlay-box"
                style={{
                  left: `${currentCfg.sigBox.leftPercent}%`,
                  bottom: `${currentCfg.sigBox.bottomPercent}%`,
                  width: `${currentCfg.sigBox.widthPercent * scaleRatio}%`,
                  height: `${currentCfg.sigBox.heightPercent * scaleRatio}%`,
                }}
              >
                <img alt="Applied Signature" src={signatureSrc} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
