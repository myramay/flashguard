// Lucide icons, bundled locally (no CDN). Replaces <i data-lucide="name"> with inline SVG.
import {
  createIcons,
  Upload,
  ShieldCheck,
  Lock,
  ScanEye,
  Captions,
  Download,
  Copy,
  CircleCheck,
  CircleX,
  TriangleAlert,
  Sparkles,
  RotateCcw,
  Info,
  Play,
  FileVideo,
} from 'lucide';

const icons = { Upload, ShieldCheck, Lock, ScanEye, Captions, Download, Copy, CircleCheck, CircleX, TriangleAlert, Sparkles, RotateCcw, Info, Play, FileVideo };

export function renderIcons(root = document) {
  createIcons({
    icons,
    root,
    attrs: { 'aria-hidden': 'true', focusable: 'false', 'stroke-width': 2 },
  });
}
