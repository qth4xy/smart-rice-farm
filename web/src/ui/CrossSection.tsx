// Animated cross-section of the paddy, the perforated observation pipe, both floats and the pump.
// In simulation the water level is drawn exactly. In live mode the floats only give a zone, so the
// pipe shows the zone band (hatched) and never a made-up level.
import type { DeviceView } from '../data/view';
import type { Zone } from '../logic/types';
import { signedCm } from './format';

const W = 640;
const H = 560;
const K = 12; // px per cm
const Y0 = 250; // soil surface (0 cm)
const y = (cm: number) => Y0 - cm * K;
const PIPE_X = 300;
const PIPE_W = 52;
const FIELD_L = 16;
const FIELD_R = 470;

const ZONE_RANGE: Partial<Record<Zone, [number, number]>> = {
  BELOW: [-20, -15],
  BETWEEN: [-15, 5],
  ABOVE: [5, 10],
};

function Plant({ x }: { x: number }) {
  const base = Y0;
  return (
    <g className="plant" transform={`translate(${x} ${base})`}>
      <path d="M0 0 C -2 -40, -14 -70, -26 -96" />
      <path d="M0 0 C 1 -45, 4 -80, 2 -118" />
      <path d="M0 0 C 3 -38, 14 -66, 28 -90" />
      <path d="M0 0 C -1 -30, -8 -48, -16 -60" />
      <path className="grain" d="M2 -118 c 6 4, 10 12, 12 22" />
    </g>
  );
}

export function CrossSection({ v }: { v: DeviceView }) {
  const level = v.levelCm;
  const lowWet = v.floatLow === 'WET';
  const highWet = v.floatHigh === 'WET';
  const fieldWater = level !== null && level > 0 ? level : 0;
  const band = level === null ? ZONE_RANGE[v.zone] : undefined;
  const pumpOn = v.pump;

  return (
    <svg className="xsec" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cross-section of the paddy and the observation pipe">
      <defs>
        <pattern id="soilTex" width="18" height="18" patternUnits="userSpaceOnUse">
          <rect width="18" height="18" className="soil" />
          <circle cx="4" cy="5" r="1.6" className="soil-dot" />
          <circle cx="13" cy="12" r="1.3" className="soil-dot" />
        </pattern>
        <pattern id="wetTex" width="18" height="18" patternUnits="userSpaceOnUse">
          <rect width="18" height="18" className="soil-wet" />
          <circle cx="4" cy="5" r="1.6" className="soil-dot" />
          <circle cx="13" cy="12" r="1.3" className="soil-dot" />
        </pattern>
        <pattern id="hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="10" height="10" className="hatch-bg" />
          <line x1="0" y1="0" x2="0" y2="10" className="hatch-line" />
        </pattern>
        <clipPath id="pipeIn">
          <rect x={PIPE_X + 4} y={y(10)} width={PIPE_W - 8} height={y(-20) - y(10)} />
        </clipPath>
      </defs>

      {/* soil, saturated below the water table */}
      <rect x={0} y={Y0} width={W} height={H - Y0} fill="url(#soilTex)" />
      {level !== null && level < 0 && <rect x={0} y={y(level)} width={W} height={H - y(level)} fill="url(#wetTex)" />}
      {level !== null && level >= 0 && <rect x={0} y={Y0} width={W} height={H - Y0} fill="url(#wetTex)" />}

      {/* standing water on the field */}
      {fieldWater > 0 && <rect className="water" x={FIELD_L} y={y(fieldWater)} width={FIELD_R - FIELD_L} height={fieldWater * K} />}
      <line className="soil-line" x1={0} x2={W} y1={Y0} y2={Y0} />

      {[30, 80, 130, 180].map((x) => (
        <Plant key={x} x={x} />
      ))}

      {/* bund (dike) on the right, pump sits on it */}
      <path className="bund" d={`M${FIELD_R} ${Y0} L${FIELD_R + 30} ${y(9)} L${W} ${y(9)} L${W} ${Y0} Z`} />

      {/* observation pipe */}
      <g>
        <rect className="pipe-bg" x={PIPE_X} y={y(10)} width={PIPE_W} height={y(-20) - y(10)} rx={4} />
        {level !== null && (
          <rect
            className="water pipe-water"
            clipPath="url(#pipeIn)"
            x={PIPE_X}
            y={y(Math.min(level, 10))}
            width={PIPE_W}
            height={Math.max(0, y(-20) - y(Math.min(level, 10)))}
          />
        )}
        {band && <rect clipPath="url(#pipeIn)" x={PIPE_X} y={y(band[1])} width={PIPE_W} height={(band[1] - band[0]) * K} fill="url(#hatch)" />}
        {Array.from({ length: 14 }, (_, i) => (
          <circle key={i} className="perf" cx={PIPE_X + (i % 2 ? 12 : PIPE_W - 12)} cy={y(9) + i * 26} r={3} />
        ))}
        <rect className="pipe" x={PIPE_X} y={y(10)} width={PIPE_W} height={y(-20) - y(10)} rx={4} />
      </g>

      {/* level scale */}
      {[
        [10, '+10'],
        [5, '+5'],
        [0, '0'],
        [-15, '−15'],
        [-20, '−20'],
      ].map(([cm, label]) => (
        <g key={cm as number} className={cm === 5 || cm === -15 ? 'tick key' : 'tick'}>
          <line x1={PIPE_X - 44} x2={PIPE_X - 4} y1={y(cm as number)} y2={y(cm as number)} />
          <text x={PIPE_X - 50} y={y(cm as number) + 7} textAnchor="end">
            {label}
          </text>
        </g>
      ))}
      <text className="unit" x={PIPE_X - 50} y={y(10) - 18} textAnchor="end">
        cm
      </text>

      {/* floats */}
      {[
        { cm: 5, wet: highWet, name: 'FLOAT HIGH', job: 'stop' },
        { cm: -15, wet: lowWet, name: 'FLOAT LOW', job: 'start' },
      ].map((f) => (
        <g key={f.name} className={f.wet ? 'float wet' : 'float dry'}>
          <circle cx={PIPE_X + PIPE_W / 2} cy={y(f.cm)} r={11} />
          <line x1={PIPE_X + PIPE_W + 4} x2={PIPE_X + PIPE_W + 22} y1={y(f.cm)} y2={y(f.cm)} />
          <text x={PIPE_X + PIPE_W + 28} y={y(f.cm) - 4}>
            {f.name}
          </text>
          <text className="sub" x={PIPE_X + PIPE_W + 28} y={y(f.cm) + 20}>
            {f.wet ? 'WET' : 'DRY'} · {f.job}s pump
          </text>
        </g>
      ))}

      {/* pump on the bund, outlet pours into the field */}
      <g className={pumpOn ? 'pump on' : 'pump'}>
        <path className="hose" d={`M${W - 18} ${y(9) + 70} L${W - 18} ${y(9) - 10} L${FIELD_R - 6} ${y(9) - 10} L${FIELD_R - 6} ${y(9) + 8}`} />
        {pumpOn && (
          <path className="flow" d={`M${W - 18} ${y(9) + 70} L${W - 18} ${y(9) - 10} L${FIELD_R - 6} ${y(9) - 10} L${FIELD_R - 6} ${y(9) + 8}`} />
        )}
        <rect x={W - 92} y={y(9) - 46} width={64} height={40} rx={8} />
        <text x={W - 60} y={y(9) - 19} textAnchor="middle">
          PUMP
        </text>
        {pumpOn && <path className="pour" d={`M${FIELD_R - 6} ${y(9) + 8} q 2 30, -4 ${Y0 - y(9) - 8 - (fieldWater > 0 ? fieldWater * K : 0)}`} />}
      </g>

      {/* level readout (simulation only) */}
      {level !== null ? (
        <g className="readout">
          <text x={24} y={44}>
            Water {signedCm(level)}
          </text>
          <text className="sub" x={24} y={72}>
            simulated level
          </text>
        </g>
      ) : (
        <g className="readout">
          <text x={24} y={44}>
            Zone only
          </text>
          <text className="sub" x={24} y={72}>
            floats give a band, not a level
          </text>
        </g>
      )}
    </svg>
  );
}
