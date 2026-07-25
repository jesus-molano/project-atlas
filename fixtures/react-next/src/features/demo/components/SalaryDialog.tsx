import { Button } from "../../../components/ui/Button";

interface DialogProps {
  title: string;
  description: string;
  onClose(): void;
}

function DialogSummary({ title }: { title: string }) {
  return <p className="text-sm muted-copy">{title}</p>;
}

export function SalaryDialog({ title, description }: DialogProps) {
  return (
    <section className="rounded-xl surface-panel">
      <DialogSummary title={title} />
      <p>{description}</p>
      <Button>Save salary</Button>
    </section>
  );
}
