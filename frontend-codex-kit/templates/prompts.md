# Prompt starters

Repository and conversation only:

```text
$frontend-task Prepara e implementa esta tarea: <resultado esperado>.
Usa el repositorio actual y no asumas que existen Jira, Confluence o Figma.
```

Ticket with optional sources:

```text
$frontend-task Prepara <ISSUE-KEY>. Usa el ticket y cualquier Confluence o
Figma enlazado solo si está accesible. Antes de crear UI, consulta Atlas.
```

Direct Figma node:

```text
$frontend-task Este frame es el objetivo confirmado: <FIGMA-NODE-URL>.
Cruza su contexto con Atlas y reutiliza componentes existentes.
```

General Figma discovery:

```text
$frontend-task Mapea este Figma: <FIGMA-FILE-OR-PAGE-URL>.
Para "<tarea>", propón hasta tres candidatos explicables y espera confirmación
antes de pedir contexto profundo.
```

Requirements grill without generic interrogation:

```text
$frontend-task Prepara esta tarea y elévame solo decisiones que cambien
comportamiento, accesibilidad, arquitectura o el target de diseño. Cada duda
debe incluir evidencia y tu recomendación.
```

Compact Project Atlas context:

```text
$frontend-task Prepara esta tarea con un presupuesto pequeño de contexto.
Consulta memoria, código y diseño solo si aportan evidencia; expande únicamente
IDs confirmados y ejecuta el gate antes de editar.
```

Close and propose a learning:

```text
Registra el resultado verificado de esta tarea. Si hemos aprendido una decisión
o convención durable, propón el delta de memoria con evidencia, pero no lo
apliques sin mi confirmación.
```
