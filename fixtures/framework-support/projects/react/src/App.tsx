import { Button } from "./components/Button";
import { useTheme } from "./hooks/useTheme";

export default function App() {
  useTheme();
  return <Button tone="primary">Continue</Button>;
}
