/**
 * mcp-server/src/normativa-filter.ts
 *
 * COPIA-PARIDAD de lib/sanitization/normativa-output-filter.ts (el sub-paquete
 * stdio es standalone). Si cambias uno, cambia el otro.
 * E2E r4 (2026-07-08): NEUTRALIZA (conserva texto interior sin metadatos), no borra.
 */

/**
 * Etiquetas del formato de corpus, con sus atributos (donde viven los metadatos
 * fabricados). El `` `? `` a cada lado consume el backtick de código inline que
 * ENVUELVE la etiqueta (E2E r5.2: el modelo escribió `<NORMATIVA_VIGENTE…>` en
 * código inline y la eliminación del tag dejaba un par de backticks vacío ``).
 */
const NORMATIVA_TAG_RE = /`?<\/?(?:NORMATIVA_VIGENTE|ARTICULO)\b[^>]*\/?>`?/gi;
/** Aperturas de bloque (para contar bloques neutralizados). */
const NORMATIVA_OPEN_RE = /`?<NORMATIVA_VIGENTE\b[^>]*>`?/gi;
/**
 * Par de backticks VACÍO aislado (artefacto residual de la eliminación, p. ej.
 * cuando el tag iba envuelto en DOBLE backtick). Solo cuando el par está rodeado
 * de espacio/puntuación: un `` pegado a contenido es el delimitador de un span
 * de doble backtick legítimo (``código``) y NO se toca (limpieza conservadora).
 */
const EMPTY_BACKTICK_PAIR_RE = /(^|[\s(])`[ \t]*`(?=$|[\s).,;:])/gm;

/**
 * 🔴 EL AVISO VA EN EL IDIOMA DEL INFORME (2026-08-10).
 *
 * Era un literal castellano fijo, y salía tal cual dentro de un informe INGLÉS a un
 * despacho inglés. Lo destapó correr un caso real del goldset británico y leer la salida:
 * el modelo fabricó un bloque de corpus, el filtro lo cazó —que es la buena noticia— y
 * escribió la mala noticia en un idioma que el lector no tiene por qué leer.
 *
 * Un aviso que no se entiende no avisa. Y este es el aviso que dice «lo que sigue no está
 * verificado»: si no se lee, el texto fabricado pasa por bueno.
 *
 * Sin default a `es`: `idiomaDelAviso` cae a la PRIMERA columna de la tabla, que es una
 * propiedad de los datos y no un privilegio escrito en el código. Añadir un idioma es
 * añadir una fila.
 */
const AVISO: Readonly<Record<string, string>> = {
  en: "[⚠ LEGISLATIVE CONTENT WITHOUT OFFICIAL BACKING — the model produced a block in corpus format; its metadata (identifiers, URLs, in-force dates) has been removed as fabricated and the text that follows is NOT verified against the corpus] ",
  es: "[⚠ CONTENIDO NORMATIVO SIN RESPALDO OFICIAL — el modelo generó un bloque con formato de corpus; sus metadatos (identificadores, URLs, vigencias) se han eliminado por fabricados y el texto que sigue NO está verificado contra el corpus] ",
  fr: "[⚠ CONTENU NORMATIF SANS FONDEMENT OFFICIEL — le modèle a produit un bloc au format du corpus ; ses métadonnées (identifiants, URL, dates de vigueur) ont été supprimées comme fabriquées et le texte qui suit n'est PAS vérifié contre le corpus] ",
  de: "[⚠ RECHTSINHALT OHNE AMTLICHE GRUNDLAGE — das Modell hat einen Block im Korpusformat erzeugt; seine Metadaten (Kennungen, URLs, Geltungsdaten) wurden als erfunden entfernt, und der folgende Text ist NICHT gegen den Korpus geprüft] ",
  ko: "[⚠ 공식 근거 없는 법령 내용 — 모델이 코퍼스 형식의 블록을 생성했습니다. 식별자·URL·시행일 등 메타데이터는 조작된 것으로 보아 삭제했으며, 이어지는 본문은 코퍼스와 대조 검증되지 않았습니다] ",
};

const idiomaDelAviso = (language?: string): string => {
  const k = (language ?? "").slice(0, 2).toLowerCase();
  return k && k in AVISO ? k : Object.keys(AVISO)[0];
};

export interface NormativaOutputFilterResult {
  text: string;
  /** Nº de bloques fabricados neutralizados. 0 = salida limpia. */
  stripped: number;
}

/**
 * Neutraliza en el OUTPUT del modelo cualquier bloque <NORMATIVA_VIGENTE>
 * (fabricado por definición): elimina etiquetas y metadatos, conserva el texto
 * interior con advertencia delante. Idempotente (la advertencia no contiene
 * etiquetas y una salida ya limpia no re-matchea).
 */
export function stripLlmNormativaBlocks(
  text: string,
  /** Idioma del informe. Sin valor cae a la primera fila de `AVISO`. */
  language?: string,
): NormativaOutputFilterResult {
  if (!text || !text.includes("<NORMATIVA_VIGENTE")) return { text, stripped: 0 };

  const WARNING = AVISO[idiomaDelAviso(language)];

  const stripped = (text.match(NORMATIVA_OPEN_RE) ?? []).length;

  // La advertencia se inserta EN el lugar de la primera apertura (una sola vez
  // por pasada, aunque haya varios bloques: el aviso cubre todo lo que sigue).
  let warned = false;
  const cleaned = text
    .replace(NORMATIVA_OPEN_RE, () => {
      if (warned) return "";
      warned = true;
      return WARNING;
    })
    .replace(NORMATIVA_TAG_RE, "")
    // Artefactos inequívocos de la neutralización (E2E r5.2): par de backticks
    // vacío aislado, y luego el whitespace huérfano (los espacios dobles que
    // dejan las etiquetas —y el propio par vacío— al desaparecer).
    .replace(EMPTY_BACKTICK_PAIR_RE, "$1")
    .replace(/[ \t]{2,}/g, " ");

  return { text: cleaned, stripped };
}
