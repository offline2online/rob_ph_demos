/* Vision/AI Custom-preset settings (ticket Ni2shuu2VdmRWYc5veb1): mirrors the
   live HQ Admin panel. Labels, section headings and info-icon tooltips only —
   no body copy. The four performance keys are the ones DETECTION_PRESETS sets;
   every other key keeps its own default until an admin changes it. */
export type VisionFieldKind = 'number' | 'select' | 'switch'
export interface VisionField {
  key: string
  label: string
  tip: string
  kind: VisionFieldKind
  default: number | string | boolean
  min?: number
  step?: number
  precision?: number
  options?: string[]
}
export interface VisionSection { id: string; title: string; fields: VisionField[] }

export const AGE_LIBRARIES = ['face-api', 'MiVOLO']

export const VISION_SECTIONS: VisionSection[] = [
  {
    id: 'performance',
    title: 'Performance & Detection Cadence',
    fields: [
      { key: 'streamQuality', label: 'Stream Quality', kind: 'number', default: 640, min: 1, precision: 0, tip: 'Camera input size in pixels. Higher quality improves face detail but increases CPU usage.' },
      { key: 'fps', label: 'Detection FPS', kind: 'number', default: 15, min: 1, precision: 0, tip: 'Maximum detection loop rate. Higher FPS reacts faster but uses more CPU.' },
      { key: 'frameSkip', label: 'Frame Skip', kind: 'number', default: 5, min: 0, precision: 0, tip: 'Number of frames skipped between detections. Higher values reduce compute load but may miss short visits.' },
      { key: 'missThreshold', label: 'Miss Threshold', kind: 'number', default: 15, min: 0, precision: 0, tip: 'Number of consecutive missed detection cycles before a visitor is marked as gone.' },
    ],
  },
  {
    id: 'quality',
    title: 'Detection Quality',
    fields: [
      { key: 'minFaceSize', label: 'Minimum Face Size', kind: 'number', default: 60, min: 1, precision: 0, tip: 'Smallest face size accepted in pixels. Higher values ignore distant or small faces.' },
      { key: 'minDetectionScore', label: 'Minimum Detection Score', kind: 'number', default: 0.9, min: 0, step: 0.05, tip: 'Minimum confidence before a detected face is used for targeting or tracking.' },
      { key: 'stage1Threshold', label: 'Stage 1 Threshold', kind: 'number', default: 0.6, min: 0, step: 0.05, tip: 'First MTCNN stage confidence threshold. Higher is stricter.' },
      { key: 'stage2Threshold', label: 'Stage 2 Threshold', kind: 'number', default: 0.7, min: 0, step: 0.05, tip: 'Second MTCNN stage confidence threshold. Higher is stricter.' },
      { key: 'stage3Threshold', label: 'Stage 3 Threshold', kind: 'number', default: 0.7, min: 0, step: 0.05, tip: 'Final MTCNN stage confidence threshold. Higher is stricter.' },
    ],
  },
  {
    id: 'age',
    title: 'Age & Targeting Quality',
    fields: [
      { key: 'ageLibrary', label: 'Age Detection Library', kind: 'select', default: AGE_LIBRARIES[0], options: AGE_LIBRARIES, tip: 'Selects which library estimates age. Detection, gender, and person tracking still use the face detection pipeline.' },
      { key: 'straightFaceTolerance', label: 'Straight Face Tolerance', kind: 'number', default: 0.5, min: 0, step: 0.05, tip: 'Front-facing tolerance for accepting stable age samples. Lower is stricter and uses fewer frames.' },
      { key: 'lowConfidenceScore', label: 'Low Confidence Score', kind: 'number', default: 0.5, min: 0, step: 0.05, tip: 'Minimum confidence for age samples that can contribute to a stable age.' },
      { key: 'highConfidenceScore', label: 'High Confidence Score', kind: 'number', default: 0.8, min: 0, step: 0.05, tip: 'Confidence needed for high-quality age samples that stabilize age faster.' },
      { key: 'lowConfidenceSamples', label: 'Low Confidence Samples', kind: 'number', default: 8, min: 1, precision: 0, tip: 'Number of lower-confidence samples needed before stable age can be used.' },
      { key: 'highConfidenceSamples', label: 'High Confidence Samples', kind: 'number', default: 3, min: 1, precision: 0, tip: 'Number of high-confidence samples needed before stable age can be used.' },
      { key: 'maxAgeSamples', label: 'Max Age Samples', kind: 'number', default: 20, min: 1, precision: 0, tip: 'Maximum recent age samples kept per tracked visitor.' },
      { key: 'stableAgeKeepTime', label: 'Stable Age Keep Time', kind: 'number', default: 3000, min: 0, precision: 0, tip: 'How long stable age is reused when a visitor remains tracked but age quality drops briefly.' },
    ],
  },
  {
    id: 'tracking',
    title: 'Advanced Person Tracking',
    fields: [
      { key: 'personMatchThreshold', label: 'Person Match Threshold', kind: 'number', default: 0.5, min: 0, step: 0.05, tip: 'Descriptor distance threshold for matching one visitor across frames. Lower is stricter.' },
      { key: 'multiFaceMatchThreshold', label: 'Multi-face Match Threshold', kind: 'number', default: 0.4, min: 0, step: 0.05, tip: 'Descriptor threshold when multiple faces are visible. Usually stricter to avoid swapping people.' },
      { key: 'reentryMatchThreshold', label: 'Re-entry Match Threshold', kind: 'number', default: 0.6, min: 0, step: 0.05, tip: 'Looser threshold for matching a recently seen visitor who briefly left the frame.' },
      { key: 'ambiguityMargin', label: 'Ambiguity Margin', kind: 'number', default: 0.05, min: 0, step: 0.01, tip: 'Required gap between best and second-best match. Higher reduces ambiguous matches.' },
      { key: 'reentryGraceTime', label: 'Re-entry Grace Time', kind: 'number', default: 5000, min: 0, precision: 0, tip: 'Milliseconds a visitor can disappear and still be matched as the same person.' },
      { key: 'descriptorGallerySize', label: 'Descriptor Gallery Size', kind: 'number', default: 5, min: 1, precision: 0, tip: 'Number of face descriptor samples kept per visitor. More samples can improve stability but use more memory.' },
      { key: 'singleFaceBoxFallback', label: 'Single-face Box Fallback', kind: 'number', default: 0.3, min: 0, step: 0.05, tip: 'Box-position fallback score used when descriptor matching is unavailable for one visible face.' },
      { key: 'multiFaceBoxFallback', label: 'Multi-face Box Fallback', kind: 'number', default: 0.6, min: 0, step: 0.05, tip: 'Box-position fallback score when multiple faces are visible. Higher reduces incorrect swaps.' },
    ],
  },
  {
    id: 'debug',
    title: 'Debug Display',
    fields: [
      { key: 'showVideo', label: 'Show detecting faces video', kind: 'switch', default: false, tip: 'Shows raw camera video so admins can confirm camera angle, lighting, and stream size.' },
      { key: 'showOverlay', label: 'Show detection overlay', kind: 'switch', default: false, tip: 'Shows canvas overlay, face boxes, labels, and same-person markers for troubleshooting.' },
      { key: 'showMetrics', label: 'Show detection metrics', kind: 'switch', default: false, tip: 'Shows FPS, detection timing, active age provider, and latest detection time.' },
    ],
  },
]

export const PRESET_TIP = 'Preset applies grouped defaults for speed versus accuracy. Manual changes switch this to Custom.'
