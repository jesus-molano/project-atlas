import type { ReactNode } from "react";

interface ButtonProps {
  children: ReactNode;
  tone?: "primary" | "quiet";
}

export function Button({ children, tone = "quiet" }: ButtonProps) {
  return <button className={`button button-${tone}`}>{children}</button>;
}
