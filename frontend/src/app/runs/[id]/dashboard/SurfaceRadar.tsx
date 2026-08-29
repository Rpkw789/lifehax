"use client";

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";

import { radarPoints, weakestSurface } from "@/lib/surfaces";
import type { Surface } from "@/lib/types";
import styles from "./SurfaceRadar.module.css";

/**
 * The five surfaces as one shape.
 *
 * A radar earns its place here where five bars did not: the profile is the
 * point, and a dent in one axis is read instantly rather than assembled from
 * five numbers. Drawn in the product's own tokens — recharts defaults would
 * put a blue that appears nowhere else on the page.
 */
export function SurfaceRadar({ surfaces }: { surfaces: Surface[] }) {
  const points = radarPoints(surfaces);
  const weakest = weakestSurface(surfaces);

  return (
    <>
      <div className={styles.wrap}>
        <div className={styles.chart}>
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={points} outerRadius="72%">
              <PolarGrid stroke="var(--divider)" />
              <PolarAngleAxis
                dataKey="surface"
                tick={{ fill: "var(--tertiary)", fontSize: 11 }}
              />
              {/* The ring labels would repeat what the list already says. */}
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <Radar
                dataKey="score"
                stroke="var(--ink)"
                fill="var(--ink)"
                fillOpacity={0.12}
                strokeWidth={1.5}
                isAnimationActive
                animationDuration={620}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <ul className={styles.notes}>
          {surfaces.map((surface) => (
            <li className={styles.note} key={surface.name}>
              <span className={styles.noteName}>{surface.name}</span>
              <span className={styles.noteScore}>{surface.score}</span>
              {surface.note ? (
                <span className={styles.noteBody}>{surface.note}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <p className={styles.caption}>
        {weakest ? (
          <>
            Weakest surface:{" "}
            <span className={styles.captionStrong}>{weakest.name}</span> at{" "}
            {weakest.score}. Fixing it moves the shape more than anything else here.
          </>
        ) : (
          "Every surface is at full score."
        )}
      </p>
    </>
  );
}
