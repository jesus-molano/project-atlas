import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "danger";
  disabled?: boolean;
};

export function Button({ children, variant = "primary" }: ButtonProps) {
  return <button className="rounded-md action-control">{children}</button>;
}
