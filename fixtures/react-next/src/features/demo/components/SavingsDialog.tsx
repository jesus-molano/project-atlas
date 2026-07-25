import { Button } from "../../../components/ui/Button";

interface DialogProps {
  title: string;
  description: string;
  onClose(): void;
}

function SavingsSummary({ title }: { title: string }) {
  return <p className="text-sm muted-copy">{title}</p>;
}

export function SavingsDialog({ title, description }: DialogProps) {
  return (
    <section className="rounded-xl surface-panel">
      <SavingsSummary title={title} />
      <p>{description}</p>
      <Button>Save target</Button>
    </section>
  );
}
