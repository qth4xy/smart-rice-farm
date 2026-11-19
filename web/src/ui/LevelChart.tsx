// Water level over time: the AWD sawtooth with the +5 / −15 cm thresholds and pump-ON periods
// shaded. In live mode there is no level (floats give zones), so it draws zone bands instead and
// never a fake continuous line.
import { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';

import type { HistoryPoint } from '../data/view';
import type { Zone } from '../logic/types';
import { fmtShortDateTime, signedCm, ZONE_TEXT } from './format';

const ZONE_BAND: Partial<Record<Zone, [number, number]>> = { BELOW: [-20, -15], BETWEEN: [-15, 5], ABOVE: [5, 10] };

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

interface Tip {
  x: number;
  y: number;
  time: string;
  value: string;
  pump: boolean;
}

export function LevelChart({ history, live, theme }: { history: HistoryPoint[]; live: boolean; theme: string }) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const histRef = useRef(history);
  const [tip, setTip] = useState<Tip | null>(null);
  histRef.current = history;

  // (Re)build the chart when the mode or theme changes.
  useEffect(() => {
    const el = host.current!;
    const ink2 = css('--ink-2');
    const grid = css('--grid');
    const water = css('--water');
    const pump = css('--pump-fill');
    const thr = css('--ink');
    const font = `${Math.round(parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.8)}px Inter Variable, system-ui, sans-serif`;

    const drawOverlays = (u: uPlot) => {
      const ctx = u.ctx;
      const h = histRef.current;
      const { left, top, width, height } = u.bbox;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, width, height);
      ctx.clip();
      // pump-ON periods: a faint full-height band plus a solid bar along the bottom, at least
      // 6 px wide so a few minutes of pumping stays visible on a multi-day axis
      const pumpSolid = css('--pump');
      const bar = 8 * devicePixelRatio;
      for (let i = 0; i < h.length; i++) {
        if (!h[i].pump) continue;
        let j = i;
        while (j + 1 < h.length && h[j + 1].pump) j++;
        const x0 = u.valToPos(h[i].t / 1000, 'x', true);
        const x1 = Math.max(x0 + 6 * devicePixelRatio, u.valToPos((h[j + 1]?.t ?? h[j].t) / 1000, 'x', true));
        ctx.fillStyle = pump;
        ctx.fillRect(x0, top, x1 - x0, height);
        ctx.fillStyle = pumpSolid;
        ctx.fillRect(x0, top + height - bar, x1 - x0, bar);
        i = j;
      }
      // live: zone bands (no level exists)
      if (live) {
        ctx.fillStyle = water + '55';
        for (let i = 0; i < h.length; i++) {
          const b = ZONE_BAND[h[i].zone];
          if (!b) continue;
          const x0 = u.valToPos(h[i].t / 1000, 'x', true);
          const x1 = u.valToPos((h[i + 1]?.t ?? h[i].t + 60_000) / 1000, 'x', true);
          const y0 = u.valToPos(b[1], 'y', true);
          const y1 = u.valToPos(b[0], 'y', true);
          ctx.fillRect(x0, y0, Math.max(1, x1 - x0), y1 - y0);
        }
      }
      // thresholds + soil line, labelled directly
      ctx.font = font.replace(/^(\d+)px/, (_, n) => `${Math.round(n * devicePixelRatio)}px`);
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'left'; // uPlot leaves it right-aligned after drawing the axes
      const lines: [number, string, number[]][] = [
        [5, '+5 cm: pump stops', [10, 8]],
        [0, 'soil surface', []],
        [-15, '−15 cm: pump starts', [10, 8]],
      ];
      for (const [cm, label, dash] of lines) {
        const yy = u.valToPos(cm, 'y', true);
        ctx.strokeStyle = cm === 0 ? ink2 : thr;
        ctx.lineWidth = (cm === 0 ? 2 : 3) * devicePixelRatio;
        ctx.setLineDash(dash.map((d) => d * devicePixelRatio));
        ctx.beginPath();
        ctx.moveTo(left, yy);
        ctx.lineTo(left + width, yy);
        ctx.stroke();
        ctx.fillStyle = cm === 0 ? ink2 : thr;
        ctx.fillText(label, left + 8 * devicePixelRatio, yy - 4 * devicePixelRatio);
      }
      ctx.restore();
    };

    const opts: uPlot.Options = {
      width: el.clientWidth,
      height: el.clientHeight,
      legend: { show: false },
      cursor: { drag: { x: false, y: false }, points: { size: 12 } },
      scales: { x: { time: true }, y: { range: [-22, 11] } },
      axes: [
        {
          stroke: ink2,
          grid: { stroke: grid, width: 1 },
          ticks: { show: false },
          font,
          values: (_u, vals) => vals.map((v) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' }).format(v * 1000)),
        },
        {
          stroke: ink2,
          grid: { stroke: grid, width: 1 },
          ticks: { show: false },
          font,
          size: 60,
          splits: () => [-20, -15, -10, -5, 0, 5, 10],
          values: (_u, vals) => vals.map((v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0')),
        },
      ],
      series: [{}, { stroke: water, width: 3, points: { show: false }, spanGaps: false }],
      hooks: {
        draw: [drawOverlays],
        setCursor: [
          (u) => {
            const i = u.cursor.idx;
            const h = histRef.current;
            if (i == null || !h[i] || u.cursor.left == null || u.cursor.left < 0) return setTip(null);
            setTip({
              x: u.cursor.left + u.bbox.left / devicePixelRatio,
              y: (u.cursor.top ?? 0) + u.bbox.top / devicePixelRatio,
              time: fmtShortDateTime(h[i].t),
              value: h[i].level === null ? ZONE_TEXT[h[i].zone].short : signedCm(h[i].level!),
              pump: h[i].pump,
            });
          },
        ],
      },
    };
    plot.current = new uPlot(opts, toData(histRef.current, live), el);
    const ro = new ResizeObserver(() => plot.current?.setSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
  }, [live, theme]);

  useEffect(() => {
    plot.current?.setData(toData(history, live));
  }, [history, live]);

  return (
    <div className="chart-wrap">
      <div className="chart-host" ref={host} onMouseLeave={() => setTip(null)} />
      {tip && (
        <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
          <div className="tip-time">{tip.time}</div>
          <div className="tip-val">
            {live ? 'Zone ' : 'Level '}
            <b>{tip.value}</b>
          </div>
          <div className="tip-pump">{tip.pump ? 'Pump ON' : 'Pump off'}</div>
        </div>
      )}
    </div>
  );
}

function toData(h: HistoryPoint[], live: boolean): uPlot.AlignedData {
  return [h.map((p) => p.t / 1000), h.map((p) => (live ? null : p.level))];
}
