import { useId, type SVGProps } from 'react';

export type BulbState = 'default' | 'thinking' | 'happy' | 'done';

const RAY_OPACITY: Record<BulbState, number> = { default: 0.45, thinking: 0.2, happy: 0.5, done: 1 };
const RAY_ANGLES = [-90, -54, -126, -18, -162];
const CX = 80;
const CY = 88;

function ray(angle: number) {
  const t = (angle * Math.PI) / 180;
  const r2 = angle === -90 ? 83 : 81;
  return {
    x1: CX + Math.cos(t) * 73, y1: CY + Math.sin(t) * 73,
    x2: CX + Math.cos(t) * r2, y2: CY + Math.sin(t) * r2,
  };
}

/** Glass silhouette: a circle with a tangent, tapering neck (same geometry as the Figma "Bulb" component). */
function Glass(props: SVGProps<SVGGElement>) {
  return (
    <g {...props}>
      <circle cx={CX} cy={CY} r={62} />
      <path d="M40.15 135.49C53.45 146.65 54 154 54 168H106C106 154 106.55 146.65 119.85 135.49Z" />
    </g>
  );
}

/**
 * Maestro's mascot. Expression lives in the eyes only.
 * Height sets the size; width follows the 2:3 aspect ratio.
 */
export default function Bulb({ state = 'default', height = 96, className = '' }: {
  state?: BulbState; height?: number; className?: string;
}) {
  const clipId = useId();
  const happy = state === 'happy' || state === 'done';
  const eyeShift = state === 'thinking' ? 'translate(7 -8)' : undefined;

  return (
    <svg
      className={`block shrink-0 overflow-visible ${className}`}
      viewBox="0 0 160 240"
      height={height}
      width={(height * 2) / 3}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={clipId}><Glass /></clipPath>
      </defs>

      <g className="transition-opacity duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transition-none" opacity={RAY_OPACITY[state]}>
        {RAY_ANGLES.map(a => {
          const r = ray(a);
          return <line key={a} {...r} stroke="#E8A93A" strokeWidth={3.5} strokeLinecap="round" />;
        })}
      </g>

      {/* Darker rim: the glass in accent-deep, overlaid by the glass nudged up-left and clipped to the outline. */}
      <Glass fill="#C48522" />
      <g clipPath={`url(#${clipId})`}>
        <Glass fill="#E8A93A" transform="translate(-6 -4)" />
      </g>

      <path fill="none" stroke="#C48522" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M74 159V150C74 144.5 86 144.5 86 150V159" />
      <rect fill="#C48522" x="50" y="166" width="60" height="7" rx="3.5" />
      <path fill="#2A2A30" d="M70 208H90V211A6 6 0 0 1 84 217H76A6 6 0 0 1 70 211Z" />
      <rect fill="#3A3A42" x="54" y="173" width="52" height="36" rx="9" />
      <rect fill="#2A2A30" x="61" y="184" width="38" height="2.5" rx="1.25" />
      <rect fill="#2A2A30" x="61" y="195" width="38" height="2.5" rx="1.25" />

      <g className="transition-transform duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transition-none" transform={eyeShift}>
        {happy ? (
          <>
            <path fill="none" stroke="#09090B" strokeWidth={3.75} strokeLinecap="round" d="M58 96C61 89 72 89 75 96" />
            <path fill="none" stroke="#09090B" strokeWidth={3.75} strokeLinecap="round" d="M85 96C88 89 99 89 102 96" />
          </>
        ) : (
          <>
            <rect fill="#09090B" x="58" y="82" width="11" height="22" rx="5.5" />
            <rect fill="#09090B" x="91" y="82" width="11" height="22" rx="5.5" />
          </>
        )}
      </g>
    </svg>
  );
}

/** The small bulb-in-a-tile mark used beside the "Maestro" wordmark. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-grid shrink-0 place-items-center rounded-[8px] border border-line bg-maestro-wash" style={{ width: size, height: size }} aria-hidden="true">
      <Bulb height={Math.round(size * 0.86)} />
    </span>
  );
}
