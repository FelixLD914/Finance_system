import type { PropsWithChildren } from "react";

export function ThaiText({ children }: PropsWithChildren) {
  return (
    <span className="thai-copy" lang="th">
      {children}
    </span>
  );
}

