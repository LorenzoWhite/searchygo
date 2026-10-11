"use client";

import { useLayoutEffect, useRef } from "react";
import { rollNumber } from "@/lib/motion";

const count = new Intl.NumberFormat("en-US");

/** A number that ticks to its new value like a Life Point counter. */
export function RollingNumber({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  useLayoutEffect(() => {
    if (ref.current) rollNumber(ref.current, shown.current, value, count.format);
    shown.current = value;
  }, [value]);
  return (
    <>
      {/* The ticking digits are for the eye; a screen reader gets the final number once. */}
      <span className="visually-hidden">{count.format(value)}</span>
      <span ref={ref} aria-hidden="true" />
    </>
  );
}
