# Prompt starters

Small repository-only change:

```text
$frontend-task Implementa este cambio localizado: <resultado esperado>.
Usa el repositorio actual, conserva el patrón existente y valida de forma
proporcional. No asumas Jira, Confluence o Figma.
```

Medium task with confirmed sources:

```text
/plan $frontend-task Implementa <ISSUE-KEY>. Confirmo que uses este ticket y
sus enlaces materiales de Confluence/Figma: <links>. Decide reutilización y
bloquea el alcance antes de editar. Registra criterios de aceptación y un
checkpoint de continuación al cerrar cada hito semántico.
```

Large feature or migration:

```text
/plan $frontend-task Prepara e implementa <objetivo amplio>. Divide el trabajo
en superficies verificables, identifica fuentes autoritativas, riesgos y
exclusiones, registra el contrato de evidencia, y usa revisión independiente
proporcional antes del cierre técnico.
```

Direct confirmed Figma node:

```text
/plan $frontend-task Este frame es el objetivo visual confirmado:
<FIGMA-NODE-URL>. Conserva su identidad exacta, crúzalo con Atlas y reutiliza
componentes existentes. Conserva un snapshot semántico acotado y renuévalo si
cambia la evidencia Figma confirmada.
```

General Figma discovery:

```text
/plan $frontend-task Usa este archivo/página Figma confirmado para <tarea>:
<FIGMA-FILE-OR-PAGE-URL>. Propón pocos candidatos explicables y expande solo
el handle que resuelva la decisión.
```

Requirements without generic interrogation:

```text
/plan $frontend-task Prepara esta tarea y elévame solo decisiones que cambien
comportamiento, accesibilidad, arquitectura, datos o autoridad visual. Cada
duda debe incluir evidencia y tu recomendación.
```

Compact Project Atlas context:

```text
/plan $frontend-task Prepara esta tarea con un presupuesto pequeño de contexto.
Expande solo handles necesarios, decide reutilización antes del lock, conserva
el contrato/continuación por handles y valida el delta completo contra ese
alcance.
```

Explore unresolved visual direction:

```text
/plan $visual-direction Resuelve la autoridad visual de esta sección, compara
solo las opciones temporales permitidas y devuelve un handoff compatible con
la tarea Atlas nativa; no cierres la tarea padre.
```

Technical close without memory:

```text
Completa el cierre técnico de esta tarea con su resultado y verificaciones. No
registres, propongas, apliques ni rechaces memoria.
```

Separate, literal memory request:

```text
Propón como memoria canónica esta convención concreta: <convención>. Usa la
evidencia <IDs/resumen>, pero no apliques la propuesta todavía.
```

Optional delivery backlog after an approved specification:

```text
Cuando la especificación esté aprobada, usa to-tickets solo para proponer un
backlog humano de unidades revisables, con dependencias y criterios de
aceptación. No crees una cola, agentes ni worktrees en Atlas.
```
