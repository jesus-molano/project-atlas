import type { ReactNode } from "react";

interface ButtonProps {
  children: ReactNode;
  variant?: "primary" | "danger";
  disabled?: boolean;
}

export function Button({ children }: ButtonProps) {
  return <button className="rounded-md action-control">{children}</button>;
}
