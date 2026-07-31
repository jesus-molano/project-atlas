export const SPANISH_EVIDENCE_MESSAGES: Readonly<Record<string, string>> = {
  "Evaluate whether {name} should be reused for this task.":
    "Evalúa si se debe reutilizar {name} para esta tarea.",
  "Repository graph": "Grafo del repositorio",
  "Code catalog results": "Resultados del catálogo de código",
  "Filter Code Atlas nodes": "Filtrar nodos de Code Atlas",
  "Name, path, prop, or intent": "Nombre, ruta, prop o intención",
  "Component scope": "Alcance del componente",
  Shared: "Compartidos",
  Feature: "Área funcional",
  Internal: "Internos",
  "Every indexed code node": "Todos los nodos de código indexados",
  "Reusable across features": "Reutilizable entre funciones",
  "Owned by one product area": "Propio de un área de producto",
  "Local implementation detail": "Detalle de implementación local",
  "No code node matches this evidence.":
    "Ningún nodo de código coincide con esta evidencia.",
  "Previous component page": "Página anterior de componentes",
  "Next component page": "Página siguiente de componentes",
  "Dependency field": "Campo de dependencias",
  parsed: "analizados",
  skipped: "omitidos",
  errors: "errores",
  "All discovered frontend files were parsed.":
    "Se analizaron todos los archivos frontend descubiertos.",
  "Explore resolved and inferred relationships, then inspect evidence for the selected node.":
    "Explora las relaciones resueltas e inferidas y después inspecciona la evidencia del nodo seleccionado.",
  "Explore exact relationships in the graph, then inspect evidence for the selected component.":
    "Explora las relaciones exactas del grafo y después inspecciona la evidencia del componente seleccionado.",
  composition: "composición",
  similarity: "similitud",
  "Graph viewport": "Vista del grafo",
  "Fit selection": "Encuadrar selección",
  "Fit graph": "Encuadrar grafo",
  "Reset graph view": "Restablecer vista del grafo",
  shared: "compartido",
  feature: "función",
  internal: "interno",
  "node size = relations": "tamaño del nodo = relaciones",
  "Close component details": "Cerrar detalles del componente",
  "Component details": "Detalles del componente",
  "Copy path": "Copiar ruta",
  "Component evidence view": "Vista de evidencias del componente",
  Reuse: "Reutilización",
  "Compare the selected component with explainable structural matches.":
    "Compara el componente seleccionado con coincidencias estructurales explicables.",
  "Trace direct and transitive consumers that could be affected.":
    "Sigue los consumidores directos y transitivos que podrían verse afectados.",
  "Associated tests": "Pruebas asociadas",
  "Review test files linked by indexed imports or mounts.":
    "Revisa archivos de prueba vinculados mediante imports o montajes indexados.",
  "Public API": "API pública",
  required: "obligatoria",
  "No statically declared props.": "No hay props declaradas estáticamente.",
  "{count} events": "{count} eventos",
  "{count} slots": "{count} slots",
  "{count} models": "{count} modelos",
  "{count} consumers": "{count} consumidores",
  direct: "directo",
  "No consumer was found within the successfully parsed files.":
    "No se encontró ningún consumidor entre los archivos analizados correctamente.",
  "No indexed code node consumes it.":
    "Ningún nodo de código indexado lo consume.",
  "Reuse candidates": "Candidatos de reutilización",
  explainable: "explicables",
  "No strong structural match yet.":
    "Aún no hay una coincidencia estructural sólida.",
  "Framework structure is inspectable for impact, but excluded from reusable-component matches.":
    "La estructura del framework se puede inspeccionar para evaluar impacto, pero se excluye de las coincidencias de componentes reutilizables.",
  "Test evidence": "Evidencia de pruebas",
  "{count} linked": "{count} vinculados",
  "copy path": "copiar ruta",
  "No test import or mount relation is indexed. Name similarity alone is not treated as evidence.":
    "No hay ninguna relación de import o montaje de pruebas indexada. La similitud de nombres por sí sola no se considera evidencia.",
  "similar name": "nombre similar",
  "shared props:": "props compartidas:",
  "shared children:": "hijos compartidos:",
  "shared style tokens:": "tokens de estilo compartidos:",
  "matching public API shape": "misma forma de API pública",
  "Synchronizing confirmed Figma source":
    "Sincronizando la fuente de Figma confirmada",
  "Figma source could not be synchronized":
    "No se pudo sincronizar la fuente de Figma",
  "Figma source confirmed, not synchronized":
    "Fuente de Figma confirmada, sin sincronizar",
  "No design metadata is indexed": "No hay metadatos de diseño indexados",
  "No Figma source confirmed for this task.":
    "No hay ninguna fuente de Figma confirmada para esta tarea.",
  "Ready for dev": "Listo para desarrollo",
  Completed: "Completado",
  "No dev status": "Sin estado de desarrollo",
  "{status} · user confirmed": "{status} · confirmado por el usuario",
  "Status unavailable from source": "Estado no disponible en la fuente",
  "No dev status observed": "No se observó estado de desarrollo",
  "{status} · indexed metadata": "{status} · metadatos indexados",
  "status unavailable": "estado no disponible",
  "no dev status observed": "sin estado de desarrollo observado",
  "Refresh the sparse Figma map for {name} and preserve provenance.":
    "Actualiza el mapa ligero de Figma de {name} y conserva la procedencia.",
  "Inspect {name} and relate it to code for this task.":
    "Inspecciona {name} y relaciónalo con el código para esta tarea.",
  "this design file": "este archivo de diseño",
  "the selected design evidence": "la evidencia de diseño seleccionada",
  "Map a Figma file or page for this project.":
    "Mapea un archivo o una página de Figma para este proyecto.",
  "Review Figma access": "Revisar acceso a Figma",
  "Map a Figma file": "Mapear un archivo de Figma",
  "Design catalog": "Catálogo de diseño",
  "Design catalog results": "Resultados del catálogo de diseño",
  "Design file": "Archivo de diseño",
  Filter: "Filtrar",
  "Frame, page, component…": "Frame, página, componente…",
  "{count} pages": "{count} páginas",
  "{count} matching nodes": "{count} nodos coincidentes",
  "{count} ready claims": "{count} declaraciones de preparación",
  Ready: "Listo",
  "No status": "Sin estado",
  Unavailable: "No disponible",
  "Open source": "Abrir fuente",
  "Indexed evidence only": "Solo evidencia indexada",
  "Synthetic lab evidence. Ready for Dev, Code Connect, variables, and connector states below are fixture claims, not live Figma verification.":
    "Evidencia sintética de laboratorio. Listo para desarrollo, Code Connect, las variables y los estados de conectores siguientes son declaraciones del fixture, no una verificación en vivo de Figma.",
  "Implementation signals": "Señales de implementación",
  Components: "Componentes",
  "None indexed": "Ninguno indexado",
  Variants: "Variantes",
  "Indexed code mappings": "Mapeos de código indexados",
  simulated: "simulado",
  Children: "Hijos",
  "Annotations & resources": "Anotaciones y recursos",
  "No annotations or resources were present in the sparse metadata.":
    "No había anotaciones ni recursos en los metadatos ligeros.",
  "No design node matches this filter.":
    "Ningún nodo de diseño coincide con este filtro.",
  "Try another search or clear the filter to see indexed nodes.":
    "Prueba otra búsqueda o borra el filtro para ver los nodos indexados.",
  "No design node selected": "No hay ningún nodo de diseño seleccionado",
  "This design file has no indexed nodes.":
    "Este archivo de diseño no tiene nodos indexados.",
  "Selected design node details": "Detalles del nodo de diseño seleccionado",
  "Design file details": "Detalles del archivo de diseño",
  "File provenance": "Procedencia del archivo",
  "Prepare design refresh": "Preparar actualización del diseño",
  "Adds a reviewed task. It does not claim a live Figma connection.":
    "Añade una tarea revisada. No afirma que exista una conexión en vivo con Figma.",
  Indexed: "Indexado",
  Modified: "Modificado",
  Version: "Versión",
  Unknown: "Desconocido",
  "Indexed status availability": "Disponibilidad del estado indexado",
  "source-unavailable": "fuente no disponible",
  Pages: "Páginas",
  "{count} indexed": "{count} indexados",
  "{count} page indexed": "{count} página indexada",
  "{count} pages indexed": "{count} páginas indexadas",
  "{count} ready node": "{count} nodo listo",
  "{count} ready nodes": "{count} nodos listos",
  "Global variables": "Variables globales",
  "{count} collections": "{count} colecciones",
  "Availability follows the connected Figma permissions.":
    "La disponibilidad depende de los permisos de Figma conectados.",
  "values indexed": "valores indexados",
  "values on demand": "valores bajo demanda",
  "Design families": "Familias de diseño",
  "{count} grouped": "{count} agrupadas",
  "Responsive widths": "Anchos adaptables",
  Flow: "Flujo",
  "no viewport evidence": "sin evidencia de viewport",
  States: "Estados",
  "Not evidenced": "Sin evidencia",
  "No responsive or storyboard family can be inferred from the sparse index.":
    "No se puede inferir ninguna familia responsive o de storyboard a partir del índice ligero.",
  "Workspace could not be loaded": "No se pudo cargar el espacio de trabajo",
  "Project Atlas could not load the active project.":
    "Project Atlas no pudo cargar el proyecto activo.",
  "Retry workspace": "Reintentar espacio de trabajo",
  "Local evidence workspace": "Espacio local de evidencias",
  "Open a project": "Abrir un proyecto",
  "Project launcher": "Selector de proyecto",
  "Project workspace": "Espacio de trabajo del proyecto",
  "Atlas scans locally, keeps project evidence isolated, and prepares compact context only when you ask an agent to help.":
    "Atlas analiza localmente, mantiene aislada la evidencia de cada proyecto y prepara contexto compacto solo cuando pides ayuda a un agente.",
  "Project folder": "Carpeta del proyecto",
  "Atlas never uploads the project.": "Atlas nunca sube el proyecto.",
  "Folder missing": "Carpeta no encontrada",
  "Remove {count} unavailable project":
    "Quitar {count} proyecto no disponible",
  "Remove {count} unavailable projects":
    "Quitar {count} proyectos no disponibles",
  "Remove link": "Quitar vínculo",
  "Remove {name} from recent projects":
    "Quitar {name} de los proyectos recientes",
  "Removing this link keeps the repository and Project Atlas data untouched.":
    "Quitar este vínculo no modifica el repositorio ni los datos de Project Atlas.",
  "This only removes unavailable links from recent-projects.json. Repositories and Project Atlas data are not deleted.":
    "Esto solo quita los vínculos no disponibles de recent-projects.json. No se eliminan repositorios ni datos de Project Atlas.",
  "Project Atlas could not remove that recent-project relation.":
    "Project Atlas no pudo quitar ese vínculo de proyecto reciente.",
  "Project Atlas could not clean unavailable recent-project relations.":
    "Project Atlas no pudo limpiar los vínculos de proyectos recientes no disponibles.",
  "Choose a recent project relation to remove.":
    "Elige un vínculo de proyecto reciente para quitarlo.",
  "That recent project relation no longer exists.":
    "Ese vínculo de proyecto reciente ya no existe.",
  "Confirm before removing multiple unavailable recent-project relations.":
    "Confirma antes de quitar varios vínculos de proyectos recientes no disponibles.",
  "Confirm local metrics deletion": "Confirmar eliminación de métricas locales",
  "This removes local content-free evaluation records. It cannot be undone.":
    "Esto elimina los registros locales de evaluación sin contenido. No se puede deshacer.",
  "Clear {count} local records": "Borrar {count} registros locales",
  Cancel: "Cancelar",
  "Change impact": "Impacto del cambio",
  "memory:item-id or design:file:node":
    "memory:id-del-elemento o design:archivo:nodo",
  "Identity or access control": "Identidad o control de acceso",
  "Biometric or multi-factor authentication":
    "Autenticación biométrica o multifactor",
  "Security or sensitive data": "Seguridad o datos sensibles",
  "Financial workflow": "Flujo financiero",
  "Destructive or data-model change":
    "Cambio destructivo o del modelo de datos",
  "Production or external side effect":
    "Producción o efecto secundario externo",
  "Runtime or stateful behavior":
    "Comportamiento de ejecución o con estado",
  "Cross-mode user experience": "Experiencia de usuario entre modos",
  "Connected-source integration": "Integración con fuente conectada",
  "Shared or cross-cutting surface": "Superficie compartida o transversal",
  "Broad task description": "Descripción de tarea amplia",
  "Small, localized presentation change":
    "Cambio de presentación pequeño y localizado",
  "No elevated-risk signal detected":
    "No se detectaron señales de riesgo elevado",
  "Add a task objective.": "Añade un objetivo para la tarea.",
  "Confirm the objective before Project Atlas starts an agent.":
    "Confirma el objetivo antes de que Project Atlas inicie un agente.",
  "Confirm, replace, omit, or mark every detected source unavailable.":
    "Confirma, sustituye, omite o marca como no disponible cada fuente detectada.",
  "A required source is unavailable or omitted.":
    "Una fuente obligatoria no está disponible o se ha omitido.",
  "Interactive component relationship map":
    "Mapa interactivo de relaciones entre componentes",
  "Global Figma variables": "Variables globales de Figma",
  "{collections} · {tokens}": "{collections} · {tokens}",
  "{count} collection": "{count} colección",
  "{count} shared token": "{count} token compartido",
  "{count} shared tokens": "{count} tokens compartidos",
  "{collections} collections · {tokens} shared tokens":
    "{collections} colecciones · {tokens} tokens compartidos",
  "Global file variables": "Variables globales del archivo",
  "Selection-only fallback": "Fallback limitado a la selección",
  "Global variables unavailable": "Variables globales no disponibles",
  "Global collections and shared tokens are indexed independently of the selected frame. Exact values appear only when the authorized source included them.":
    "Las colecciones globales y los tokens compartidos se indexan con independencia del frame seleccionado. Los valores exactos solo aparecen cuando la fuente autorizada los incluyó.",
  "The source exposes variables only for a confirmed selection. This fallback is not a global file catalog and is kept separate from global variables.":
    "La fuente solo expone variables para una selección confirmada. Este fallback no es un catálogo global del archivo y se mantiene separado de las variables globales.",
  "The connected Figma source requires permission before Atlas can read global variable collections. No absence is inferred.":
    "La fuente de Figma conectada requiere permiso antes de que Atlas pueda leer colecciones de variables globales. No se infiere ninguna ausencia.",
  "The indexed source did not expose a global variable catalog. This does not mean the file has no variables.":
    "La fuente indexada no expuso un catálogo global de variables. Esto no significa que el archivo no tenga variables.",
  "Global variable collections": "Colecciones de variables globales",
  "{count} tokens · {modes}": "{count} tokens · {modes}",
  "No modes exposed": "No se expusieron modos",
  "Shared tokens": "Tokens compartidos",
  "Used for {scopes}": "Usado para {scopes}",
  "Usage scope not exposed": "Ámbito de uso no expuesto",
  "The collection summary is available, but token names were not included in the bounded response.":
    "El resumen de la colección está disponible, pero los nombres de tokens no se incluyeron en la respuesta acotada.",
  "Selected shared token": "Token compartido seleccionado",
  Collection: "Colección",
  Origin: "Origen",
  "Usage scopes": "Ámbitos de uso",
  "Not exposed": "No expuesto",
  "Authorized mode values": "Valores autorizados por modo",
  "Alias to {id}": "Alias de {id}",
  "Exact values were not persisted. Retrieve them only on demand for a confirmed task and authorized source.":
    "Los valores exactos no se conservaron. Recupéralos solo bajo demanda para una tarea confirmada y una fuente autorizada.",
  "Authorized values indexed": "Valores autorizados indexados",
  "Catalog summary only · values on demand":
    "Solo resumen del catálogo · valores bajo demanda",
  "Choose an absolute local project folder.":
    "Elige una carpeta de proyecto local con ruta absoluta.",
  "That project folder does not exist or is not accessible.":
    "Esa carpeta de proyecto no existe o no es accesible.",
  "Choose a repository or frontend project containing .git or package.json.":
    "Elige un repositorio o proyecto frontend que contenga .git o package.json.",
  "Choose a frontend project containing package.json.":
    "Elige un proyecto frontend que contenga package.json.",
  "A folder picker is already open.":
    "Ya hay un selector de carpetas abierto.",
  "No index found. Run project-atlas scan first.":
    "No se encontró ningún índice. Ejecuta primero el análisis de Project Atlas.",
  "save-decision-and-continue": "guardar decisión y continuar",
  "resolve-decision": "resolver decisión",
  "resolve-contradiction": "resolver contradicción",
  "request-clarification": "solicitar aclaración",
  "mitigate-current-task": "mitigar en la tarea actual",
  "create-follow-up-task": "crear tarea de seguimiento",
  "accept-risk": "aceptar riesgo",
  "add-check": "añadir comprobación",
  "mark-reviewed": "marcar como revisado",
  defer: "aplazar",
  "connect-source": "conectar fuente",
  "use-alternative": "usar alternativa",
  "continue-without-evidence": "continuar sin evidencia",
  dismiss: "descartar",
  "An unexpected local error occurred.":
    "Se produjo un error local inesperado.",
  "ATLAS_PROJECT_ROOT is missing. Launch Project Atlas with the CLI open command.":
    "Falta ATLAS_PROJECT_ROOT. Abre un proyecto desde Project Atlas o usa el comando de apertura de la CLI.",
  "A reviewed agent launch payload is required.":
    "Se requiere una solicitud de inicio de agente revisada.",
  "A task is required for its content-free fingerprint.":
    "Se requiere una tarea para generar su huella sin contenido.",
  "An Action Center mutation is required.":
    "Se requiere una transición del Centro de acciones.",
  "An idempotency key is already bound to another action item.":
    "Una clave de idempotencia ya está vinculada a otro elemento de acción.",
  "A bounded idempotency key is required.":
    "Se requiere una clave de idempotencia acotada.",
  "A reason between 1 and 500 characters is required.":
    "Se requiere un motivo de entre 1 y 500 caracteres.",
  "A future defer date is required.":
    "Se requiere una fecha futura para el aplazamiento.",
  "A bounded Atlas evidence handle is required.":
    "Se requiere una referencia acotada de evidencia de Atlas.",
  "Action item identity does not match.":
    "La identidad del elemento de acción no coincide.",
  "Project identity does not match.": "La identidad del proyecto no coincide.",
  "Checkout identity does not match.": "La identidad del checkout no coincide.",
  "Evidence changed after review.": "La evidencia cambió después de la revisión.",
  "Choose one of the compared evidence sources as authority.":
    "Elige como autoridad una de las fuentes de evidencia comparadas.",
  "Unsupported Action Center schema version.":
    "La versión del esquema del Centro de acciones no es compatible.",
  "Bulk actions require between 1 and 50 items.":
    "Las acciones por lotes requieren entre 1 y 50 elementos.",
  "Bulk actions require unique items and idempotency keys.":
    "Las acciones por lotes requieren elementos y claves de idempotencia únicos.",
  "Describe the task before generating context.":
    "Describe la tarea antes de generar el contexto.",
  "Only repository and memory indexes can refresh locally.":
    "Solo los índices de repositorio y memoria se pueden actualizar localmente.",
  "Project Atlas GUI accepts loopback requests only.":
    "La interfaz de Project Atlas solo acepta solicitudes loopback.",
  "Project Atlas only accepts local same-origin changes.":
    "Project Atlas solo acepta cambios locales del mismo origen.",
  "Project Atlas rejected a cross-origin state-changing request.":
    "Project Atlas rechazó una solicitud de otro origen que modificaba el estado.",
  "Project Atlas rejected an invalid request origin.":
    "Project Atlas rechazó un origen de solicitud no válido.",
  "Project or checkout identity changed. Start a new correction brief instead.":
    "La identidad del proyecto o checkout cambió. Inicia en su lugar un nuevo encargo de corrección.",
  "Provide a material answer or correction.":
    "Proporciona una respuesta o corrección sustancial.",
  "Provide a material answer, next step, or correction.":
    "Proporciona una respuesta, un siguiente paso o una corrección sustancial.",
  "Resolve every newly detected source before continuing.":
    "Resuelve todas las fuentes recién detectadas antes de continuar.",
  "Task intent must contain 1-6,000 characters.":
    "El objetivo de la tarea debe contener entre 1 y 6.000 caracteres.",
  "The Atlas checkout snapshot changed after review. Refresh before acting.":
    "La instantánea del checkout de Atlas cambió después de la revisión. Actualiza antes de actuar.",
  "The action item no longer exists in this checkout.":
    "El elemento de acción ya no existe en este checkout.",
  "The idempotency key is already bound to another action item.":
    "La clave de idempotencia ya está vinculada a otro elemento de acción.",
  "Request body is required.": "Se requiere el cuerpo de la solicitud.",
  "A proposalId query parameter is required.":
    "Se requiere el parámetro de consulta proposalId.",
  "The write impact could not be calculated.":
    "No se pudo calcular el impacto de escritura.",
  "The source ledger is invalid.": "El registro de fuentes no es válido.",
  "The task checkpoint ID is invalid.":
    "El identificador del punto de control de la tarea no es válido.",
  "Durable memory writes require confirmed=true after reviewing the proposal.":
    "Las escrituras de memoria duradera requieren confirmación después de revisar la propuesta.",
  "Rejecting a memory proposal requires confirmed=true after reviewing it.":
    "Rechazar una propuesta de memoria requiere confirmación después de revisarla.",
  "Rejecting a memory proposal requires a reason.":
    "Rechazar una propuesta de memoria requiere un motivo.",
  "A memory proposal needs a rationale and at least one item.":
    "Una propuesta de memoria necesita una justificación y al menos un elemento.",
  "A memory proposal requires between 1 and 20 typed items.":
    "Una propuesta de memoria requiere entre 1 y 20 elementos tipados.",
  "Combining memory proposals requires confirmed=true after reviewing both.":
    "Combinar propuestas de memoria requiere confirmación después de revisar ambas.",
  "Choose two different memory proposals to combine.":
    "Elige dos propuestas de memoria diferentes para combinarlas.",
  "One of the memory proposals was not found.":
    "No se encontró una de las propuestas de memoria.",
  "Only pending memory proposals can be combined.":
    "Solo se pueden combinar propuestas de memoria pendientes.",
  "Memory proposal \"{id}\" was not found.":
    "No se encontró la propuesta de memoria \"{id}\".",
  "Memory proposal \"{id}\" is already {status}.":
    "La propuesta de memoria \"{id}\" ya está {status}.",
  "Memory proposal \"{id}\" has unresolved decision-required findings and cannot be applied.":
    "La propuesta de memoria \"{id}\" tiene hallazgos sin resolver que requieren una decisión y no puede aplicarse.",
  "Memory proposal item {index} is invalid.":
    "El elemento {index} de la propuesta de memoria no es válido.",
  "Canonical Project Memory writes require canonicalConfirmed=true after reviewing the centralized Atlas storage paths.":
    "Las escrituras canónicas de Project Memory requieren canonicalConfirmed=true después de revisar las rutas del almacenamiento centralizado de Atlas.",
  "{command} is not bulk-safe.":
    "{command} no se puede aplicar de forma segura por lotes.",
  "{command} is not allowed for {type}.":
    "{command} no está permitido para {type}.",
  "{command} cannot be applied in bulk.":
    "{command} no se puede aplicar por lotes.",
  "Figma Variables": "Variables de Figma",
  "Figma libraries": "Bibliotecas de Figma",
  "Ready for Dev": "Listo para desarrollo",
  "Permission required": "Permiso necesario",
  "No cached design evidence; live connector state has not been reported.":
    "No hay evidencia de diseño en caché; no se ha informado del estado del conector en vivo.",
  "No current session observation has been reported.":
    "No se ha informado de ninguna observación de la sesión actual.",
  "At least one indexed source exposes Dev Mode status.":
    "Al menos una fuente indexada expone el estado de Dev Mode.",
  "Cached source does not expose this field; absence is not inferred.":
    "La fuente en caché no expone este campo; no se infiere su ausencia.",
  "No design source is indexed.": "No hay ninguna fuente de diseño indexada.",
  "Global collection summaries are indexed.":
    "Los resúmenes de colecciones globales están indexados.",
  "Selection-scoped variables are available.":
    "Hay variables disponibles con alcance de selección.",
  "No variable catalog is exposed by the indexed source.":
    "La fuente indexada no expone ningún catálogo de variables.",
  "No mapping is exposed by the cached design source.":
    "La fuente de diseño en caché no expone ningún mapeo.",
  "No library metadata is exposed by the cached design source.":
    "La fuente de diseño en caché no expone metadatos de bibliotecas.",
  "No detail reported.": "No se informó de ningún detalle.",
  "Atlas scan returned an invalid graph summary.":
    "El análisis de Atlas devolvió un resumen del grafo no válido.",
  "Project memory requires a resolved checkout identity.":
    "La memoria del proyecto requiere una identidad de checkout resuelta.",
  "Refusing to write memory outside the project root.":
    "Se rechazó escribir memoria fuera de la raíz del proyecto.",
  "Refusing to write memory outside Project Atlas storage.":
    "Se rechazó escribir memoria fuera del almacenamiento de Project Atlas.",
  "A task outcome requires a task, a summary, and a valid result.":
    "El resultado de una tarea requiere una tarea, un resumen y un resultado válido.",
  "{count} cached design files; live session state is not assumed.":
    "{count} archivos de diseño en caché; no se presupone el estado de la sesión en vivo.",
  "{count} cached code connections.":
    "{count} conexiones de código en caché.",
  "{count} cached library references.":
    "{count} referencias de bibliotecas en caché.",
  "shared props": "props compartidas",
  "shared children": "hijos compartidos",
  "shared style tokens": "tokens de estilo compartidos",
  "recent scoped memory": "memoria reciente del ámbito",
  title: "título",
  tags: "etiquetas",
  summary: "resumen",
  body: "contenido",
  "name matches": "coincide el nombre",
  "hierarchy matches": "coincide la jerarquía",
  "Ready for dev description matches":
    "coincide la descripción de Listo para desarrollo",
  "annotation matches": "coinciden las anotaciones",
  "contained components match": "coinciden los componentes incluidos",
  "aligns with Atlas code": "se alinea con el código de Atlas",
  contains: "contiene",
  "matches requested mobile variant":
    "coincide con la variante móvil solicitada",
  "device variant is not explicitly mobile":
    "la variante de dispositivo no es explícitamente móvil",
  "matches requested desktop variant":
    "coincide con la variante de escritorio solicitada",
  "matches requested shared/library scope":
    "coincide con el ámbito compartido o de biblioteca solicitado",
  "belongs to a product frame rather than the shared library":
    "pertenece a un frame de producto y no a la biblioteca compartida",
  "Completed reference": "Referencia completada",
  "Parent page is Ready for dev":
    "La página superior está lista para desarrollo",
  "Selected in Project Atlas": "Seleccionado en Project Atlas",
  "Memory candidates": "Candidatos de memoria",
  "Stored after confirmation": "Guardado tras confirmación",
  "No automatic memory writes": "Sin escrituras automáticas en memoria",
  "Local / episodic outcome": "Resultado local o episódico",
  "Explicit confirmation required:": "Se requiere confirmación explícita:",
  "Confirm canonical memory": "Confirmar memoria canónica",
  "Continue without saving": "Continuar sin guardar",
  "{scope} · {count}% confidence": "{scope} · {count}% de confianza",
  "Color channels: {red}, {green}, {blue}, alpha {alpha}":
    "Canales de color: {red}, {green}, {blue}, alfa {alpha}",
  "Use native Codex for conversation and execution. This surface controls scope, source integrity, and traceability.":
    "Usa Codex nativo para conversar y ejecutar. Esta superficie controla el alcance, la integridad de fuentes y la trazabilidad.",
  "No source supplied": "No se proporcionó ninguna fuente",
  "Required source": "Fuente obligatoria",
  "Optional source": "Fuente opcional",
  "Required for this task": "Obligatoria para esta tarea",
  "{count} source receipts": "{count} recibos de fuente",
  Retrieval: "Recuperación",
  "{hits} hits · {misses} misses · {retries} retries":
    "{hits} aciertos · {misses} fallos · {retries} reintentos",
  "Not prepared": "Sin preparar",
  "Next safe action": "Siguiente acción segura",
  Covered: "Cubierto",
  Remaining: "Pendiente",
  Receipts: "Recibos",
  "Receipt IDs": "IDs de recibo",
  "The confirmed Figma target {target} has not been synchronized. Map this exact target through Figma Desktop MCP before context retrieval; Atlas candidates cannot replace it.":
    "El objetivo confirmado de Figma {target} no se ha sincronizado. Mapea este objetivo exacto mediante Figma Desktop MCP antes de recuperar contexto; los candidatos de Atlas no pueden sustituirlo.",
  "The confirmed Figma file {fileKey} has no exact current source receipt. Synchronize that file through the confirmed adapter before context retrieval.":
    "El archivo confirmado de Figma {fileKey} no tiene un recibo de fuente exacto y actual. Sincroniza ese archivo mediante el adaptador confirmado antes de recuperar contexto.",
  "Multiple exact Figma nodes are confirmed. Define one authoritative target or explicitly describe their shared scope before context retrieval.":
    "Hay varios nodos exactos de Figma confirmados. Define un objetivo autoritativo o describe explícitamente su alcance compartido antes de recuperar contexto.",
  "Required OpenAPI contracts conflict for {method} {path}. Confirm the governing contract or version before context retrieval.":
    "Los contratos OpenAPI obligatorios entran en conflicto para {method} {path}. Confirma el contrato o la versión que rige antes de recuperar contexto.",
  "A required OpenAPI contract could not be resolved ({receiptId}).":
    "No se pudo resolver un contrato OpenAPI obligatorio ({receiptId}).",
  "The confirmed Figma node is not present in the Design Index. Synchronize this exact node through Figma Desktop MCP. Do not substitute an Atlas-ranked node.":
    "El nodo confirmado de Figma no está en el índice de diseño. Sincroniza este nodo exacto mediante Figma Desktop MCP. No lo sustituyas por un nodo clasificado por Atlas.",
  "The cached design does not prove the confirmed node identity. Read and map this exact node before using it. Atlas candidates remain alternatives, not the confirmed target.":
    "El diseño en caché no demuestra la identidad del nodo confirmado. Lee y mapea este nodo exacto antes de usarlo. Los candidatos de Atlas siguen siendo alternativas, no el objetivo confirmado.",
  "The confirmed Figma node is backed only by stale or unknown evidence. Refresh the exact node through the confirmed source before implementation.":
    "El nodo confirmado de Figma solo está respaldado por evidencia obsoleta o desconocida. Actualiza el nodo exacto mediante la fuente confirmada antes de implementar.",
  "Not Reviewed": "Sin revisar",
  "Context cost audit": "Auditoría de coste de contexto",
  "{count} measured runs": "{count} ejecuciones medidas",
  "Median input": "Entrada mediana",
  "P95 input": "Entrada P95",
  "Cross-device audits move only through explicit CLI export and import.":
    "Las auditorías entre equipos se transfieren únicamente mediante exportación e importación explícitas por CLI.",
  "Theme fingerprint": "Huella visual del proyecto",
  "diff warnings": "avisos del diff",
  "{count} diff warnings": "{count} avisos del diff",
  "The local diff matches indexed theme evidence.":
    "El diff local coincide con la evidencia visual indexada.",
  "Local diff validation": "Validación del diff local",
  external: "externo",
  "Resolve externally in Codex": "Resolver externamente en Codex",
  "Resolved externally": "Resuelto externamente",
  "Recovered local task state": "Estado local de la tarea recuperado",
  Dismiss: "Descartar",
  "Copy task ID": "Copiar ID de tarea",
  "Local browsing · no model call": "Navegación local · sin llamada al modelo",
  "{count} source receipt": "{count} recibo de fuente",
  "{count} local record · no telemetry":
    "{count} registro local · sin telemetría",
  "Clear {count} local record": "Borrar {count} registro local",
  "{count} instrumented records": "{count} registros instrumentados",
  "{actual} actual / {estimated} estimated":
    "{actual} reales / {estimated} estimados",
  "Reviewed Markdown in centralized Atlas storage · outside the repository":
    "Markdown revisado en almacenamiento centralizado de Atlas · fuera del repositorio",
  "not reported in this session": "no informado en esta sesión",
  "local cache; state and freshness reported separately":
    "caché local; estado y frescura informados por separado",
  "Status not exposed by source": "Estado no expuesto por la fuente",
  "Not observed": "No observado",
  "status not exposed by source": "estado no expuesto por la fuente",
  "Source receipts": "Recibos de fuente",
  Requested: "Solicitado",
  Resolved: "Resuelto",
  "Modules & integrations": "Módulos e integraciones",
  "{shown} of {total}": "{shown} de {total}",
  "Use {name} at {path} as repository evidence for this task.":
    "Usa {name} en {path} como evidencia del repositorio para esta tarea.",
  "Open URL": "Abrir URL",
  "Copy URL": "Copiar URL",
  "{resolved} of {total} source decisions resolved":
    "{resolved} de {total} decisiones de fuentes resueltas",
  "identity matched": "identidad coincidente",
  "identity derived with evidence": "identidad derivada con evidencia",
  "resolved identity differs": "la identidad resuelta difiere",
  "content hashed": "contenido con hash",
  "metadata retrieved": "metadatos recuperados",
  "{identity} · {content} · {freshness}":
    "{identity} · {content} · {freshness}",
  tokens: "tokens",
  "Index a Figma file with the Atlas CLI, then refresh this local view.":
    "Indexa un archivo de Figma con la CLI de Atlas y después actualiza esta vista local.",
  "Local diagnostics": "Diagnóstico local",
  Usage: "Consumo",
  "Exact Codex usage": "Consumo exacto de Codex",
  "{count} exact local traces": "{count} trazas locales exactas",
  Input: "Entrada",
  Cached: "En caché",
  Output: "Salida",
  Reasoning: "Razonamiento",
  Compactions: "Compactaciones",
  "OTel / JSONL": "OTel / JSONL",
  "Legacy context-cost audit": "Auditoría heredada de coste de contexto",
  "{count} incomplete estimates": "{count} estimaciones incompletas",
  "Kept for migration only; these records are not mixed with exact totals.":
    "Se conservan solo para migración; estos registros no se mezclan con los totales exactos.",
  "Incomplete estimate": "Estimación incompleta",
  "{count} tokens": "{count} tokens",
  "{actual} SDK-actual · {estimated} character-estimated":
    "{actual} reales del SDK · {estimated} estimados por caracteres",
  "Usage records come from local Codex telemetry or explicit imports. Zero records means no instrumentation was observed; it does not prove that no work occurred.":
    "Los registros de consumo proceden de la telemetría local de Codex o de importaciones explícitas. Cero registros significa que no se observó instrumentación; no demuestra que no hubiera trabajo.",
  "Review current diff": "Revisar el diff actual",
  "Search code, design, and memory": "Buscar en código, diseño y memoria",
  "Open indexed evidence directly. Local search uses no model tokens.":
    "Abre directamente la evidencia indexada. La búsqueda local no usa tokens del modelo.",
  "Open indexed evidence": "Abrir evidencia indexada",
  "Project Atlas local session token is required.":
    "Se requiere el token de sesión local de Project Atlas.",
  "Project Atlas rejected the local session token.":
    "Project Atlas rechazó el token de sesión local.",
};
