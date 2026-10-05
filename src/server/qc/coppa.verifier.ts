/**
 * Cartoon Studio — Deterministic COPPA & Child Safety Verifier
 * Phase 09: Objective Quality Control (Audio Drift & COPPA Checks)
 *
 * Implements strict compliance audits under FTC COPPA Act (16 CFR Part 312)
 * and YouTube Made for Kids / Child Online Protection Guidelines.
 *
 * Enforces zero PII collection, zero commercial exploitation, mandatory
 * 'madeForKids: true' classification, and initially private broadcast posture.
 */

import { CoppaAuditInput, QCCheckResult } from './qc.types';

// Regex patterns for personally identifiable information (PII)
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
const PHONE_REGEX = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g;

// Lexical patterns prompting children for sensitive personal data
const PII_SOLICITATION_PATTERNS = [
  /(?:dime|cu[aá]l\s+es|escribe|comparte|p[aá]same)\s+tu\s+(?:nombre|apellido|direcci[oó]n|tel[eé]fono|colegio|escuela)/i,
  /dime\s+tu\s+nombre\s+(?:completo|y\s+apellido)?/i,
  /dime\s+tu\s+(?:tel[eé]fono|direcci[oó]n|colegio|escuela)/i,
  /cu[aá]l\s+es\s+tu\s+(?:direcci[oó]n|tel[eé]fono|colegio|escuela|nombre)/i,
  /d[oó]nde\s+vives\b/i,
  /m[aá]ndame\s+tu\s+(?:foto|ubicaci[oó]n|correo|whatsapp)/i,
  /escribe\s+tu\s+(?:email|direcci[oó]n|tel[eé]fono)\s+en\s+los\s+comentarios/i,
  /(?:what\s+is|tell\s+me)\s+your\s+(?:address|full\s+name|phone\s+number|school)/i,
  /where\s+do\s+you\s+live/i,
  /send\s+me\s+your\s+(?:picture|location|email)/i,
];

// Dangerous acts or child harm patterns
const DANGEROUS_CONTENT_PATTERNS = [
  /\b(?:pistola|escopeta|cuchillo\s+afilado|navaja|arma\s+de\s+fuego)\b/i,
  /\bjugar\s+con\s+(?:fuego|cerillas|f[oó]sforos|gasolina|lej[ií]a)\b/i,
  /\b(?:tomar|beber|tragar)\s+(?:pastillas|medicinas|alcohol|pastillas\s+de\s+mam[aá]|lej[ií]a)\b/i,
  /\bsaltar\s+(?:por\s+la\s+ventana|del\s+techo|al\s+vac[ií]o)\b/i,
  /\b(?:ahorcar|estrangular|meter\s+la\s+cabeza\s+en\s+una\s+bolsa)\b/i,
  /\b(?:groser[ií]a|idiota|imb[eé]cil|est[uú]pido|mierda|puta|bastardo|coño)\b/i,
  /\b(?:fuck|bitch|bastard|shit|asshole)\b/i,
];

// Deceptive or aggressive commercial calls to action (CTA) directed at children
const COMMERCIAL_CTA_PATTERNS = [
  /\b(?:compra\s+ya|haz\s+clic\s+para\s+comprar|pide\s+a\s+tus\s+padres\s+que\s+compren)\b/i,
  /\b(?:tarjeta\s+de\s+cr[eé]dito|dinos\s+los\s+n[uú]meros\s+de\s+la\s+tarjeta)\b/i,
  /\b(?:buy\s+now|order\s+today|ask\s+your\s+parents\s+to\s+buy)\b/i,
  /\b(?:visita\s+(?:nuestra\s+tienda|www\.[a-z0-9-]+\.(?:com|es|store)|https?:\/\/))\b/i,
];

// YouTube Kids interaction patterns (disabled by YouTube on kids content)
const RESTRICTED_INTERACTION_PATTERNS = [
  /\b(?:deja\s+un\s+comentario\s+abajo|comenta\s+abajo|escribe\s+en\s+la\s+caja\s+de\s+comentarios)\b/i,
  /\b(?:activa\s+la\s+campanita\s+de\s+notificaciones|notificaciones\s+personalizadas)\b/i,
  /\b(?:leave\s+a\s+comment\s+below|comment\s+down\s+below)\b/i,
];

/**
 * Aggregates all accessible text strings from an episode for scanning.
 */
function extractAllCorpusText(input: CoppaAuditInput): string {
  const pieces: string[] = [];
  if (input.title) pieces.push(input.title);
  if (input.educationalObjective) pieces.push(input.educationalObjective);
  if (input.dialogueTexts && input.dialogueTexts.length > 0) {
    pieces.push(...input.dialogueTexts);
  }
  if (input.narrationTexts && input.narrationTexts.length > 0) {
    pieces.push(...input.narrationTexts);
  }
  if (input.youtubeMetadata) {
    if (input.youtubeMetadata.title) pieces.push(input.youtubeMetadata.title);
    if (input.youtubeMetadata.description) pieces.push(input.youtubeMetadata.description);
    if (input.youtubeMetadata.tags) pieces.push(input.youtubeMetadata.tags.join(' '));
  }
  return pieces.join(' \n ');
}

/**
 * Executes a deterministic suite of COPPA rules and returns individual audit checks.
 */
export function verifyCoppaCompliance(input: CoppaAuditInput): QCCheckResult[] {
  const results: QCCheckResult[] = [];
  const corpus = extractAllCorpusText(input);

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 1: COPPA_MADE_FOR_KIDS_CLASSIFICATION (CRITICAL)
  // ──────────────────────────────────────────────────────────────────────────
  const isMadeForKids = input.madeForKids ?? input.youtubeMetadata?.madeForKids ?? false;
  const isCoppaConfirmed = input.coppaComplianceConfirmed ?? true;

  if (isMadeForKids && isCoppaConfirmed) {
    results.push({
      ruleCode: 'COPPA_MADE_FOR_KIDS_CLASSIFICATION',
      category: 'SAFETY_COMPLIANCE',
      severity: 'CRITICAL',
      status: 'PASS',
      score: 100,
      notes: 'Clasificación de audiencia infantil (Made for Kids) correctamente establecida conforme a 16 CFR Part 312.',
      telemetry: { madeForKids: true, coppaConfirmed: true },
    });
  } else {
    results.push({
      ruleCode: 'COPPA_MADE_FOR_KIDS_CLASSIFICATION',
      category: 'SAFETY_COMPLIANCE',
      severity: 'CRITICAL',
      status: 'FAIL',
      score: 0,
      notes: 'Violación reglamentaria: La producción está destinada a público infantil pero el indicador "madeForKids" no está activado.',
      remediation: 'Activar obligatoriamente madeForKids: true y confirmar la declaración COPPA antes de autorizar la producción.',
      telemetry: { madeForKids: isMadeForKids, coppaConfirmed: isCoppaConfirmed },
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 2: COPPA_PRIVATE_PUBLISH_DEFAULT (CRITICAL)
  // ──────────────────────────────────────────────────────────────────────────
  const privacy = (input.privacyStatus ?? input.youtubeMetadata?.privacyStatus ?? 'private').toLowerCase();
  if (privacy === 'private' || privacy === 'unlisted') {
    results.push({
      ruleCode: 'COPPA_PRIVATE_PUBLISH_DEFAULT',
      category: 'SAFETY_COMPLIANCE',
      severity: 'CRITICAL',
      status: 'PASS',
      score: 100,
      notes: `Postura de privacidad segura (${privacy.toUpperCase()}). Permite revisión humana obligatoria previa en YouTube Studio.`,
      telemetry: { privacyStatus: privacy },
    });
  } else {
    results.push({
      ruleCode: 'COPPA_PRIVATE_PUBLISH_DEFAULT',
      category: 'SAFETY_COMPLIANCE',
      severity: 'CRITICAL',
      status: 'FAIL',
      score: 0,
      notes: 'Violación de directiva de seguridad: Se intenta publicar directamente en modo PÚBLICO sin revisión humana intermedia.',
      remediation: 'Configurar visibilidad inicial obligatoria como PRIVATE para permitir auditoría editorial en YouTube Studio.',
      telemetry: { privacyStatus: privacy },
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 3: COPPA_PII_DATA_COLLECTION (CRITICAL)
  // ──────────────────────────────────────────────────────────────────────────
  const foundEmails = corpus.match(EMAIL_REGEX) || [];
  const foundPhones = corpus.match(PHONE_REGEX) || [];
  const foundSolicitations = PII_SOLICITATION_PATTERNS.filter((pattern) => pattern.test(corpus));

  const hasPiiViolation = foundEmails.length > 0 || foundPhones.length > 0 || foundSolicitations.length > 0;

  if (!hasPiiViolation) {
    results.push({
      ruleCode: 'COPPA_PII_DATA_COLLECTION',
      category: 'SAFETY_COMPLIANCE',
      severity: 'CRITICAL',
      status: 'PASS',
      score: 100,
      notes: 'Cero solicitudes o exposición de datos personales identificables (PII). Cumplimiento estricto del FTC COPPA Rule.',
      telemetry: { piiFound: false },
    });
  } else {
    const details = [
      foundEmails.length > 0 ? `Correos detectados (${foundEmails.join(', ')})` : null,
      foundPhones.length > 0 ? `Teléfonos detectados (${foundPhones.join(', ')})` : null,
      foundSolicitations.length > 0 ? 'Peticiones de nombre, domicilio o datos privados' : null,
    ].filter(Boolean).join('; ');

    results.push({
      ruleCode: 'COPPA_PII_DATA_COLLECTION',
      category: 'SAFETY_COMPLIANCE',
      severity: 'CRITICAL',
      status: 'FAIL',
      score: 0,
      notes: `Violación crítica COPPA: Se detectó recopilación o mención de datos de identificación personal: ${details}.`,
      remediation: 'Eliminar de inmediato cualquier solicitud de información privada, nombres reales, emails o teléfonos de los diálogos y metadatos.',
      telemetry: { piiFound: true, emails: foundEmails, phones: foundPhones },
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 4: COPPA_CHILD_SAFETY_CONTENT (CRITICAL)
  // ──────────────────────────────────────────────────────────────────────────
  const dangerousMatches = DANGEROUS_CONTENT_PATTERNS.filter((p) => p.test(corpus));

  if (dangerousMatches.length === 0) {
    results.push({
      ruleCode: 'COPPA_CHILD_SAFETY_CONTENT',
      category: 'SAFETY_COMPLIANCE',
      severity: 'CRITICAL',
      status: 'PASS',
      score: 100,
      notes: 'Contenido 100% seguro para público infantil. Libre de lenguaje soez, armas o actos peligrosos imitables.',
      telemetry: { safeContent: true },
    });
  } else {
    results.push({
      ruleCode: 'COPPA_CHILD_SAFETY_CONTENT',
      category: 'SAFETY_COMPLIANCE',
      severity: 'CRITICAL',
      status: 'FAIL',
      score: 0,
      notes: 'Violación de seguridad infantil: Se detectaron expresiones o menciones a armas, violencia, sustancias o actos de alto riesgo imitables.',
      remediation: 'Reescribir las escenas afectadas para excluir cualquier referencia a peligro físico, violencia o lenguaje inadecuado.',
      telemetry: { matchesCount: dangerousMatches.length },
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 5: COPPA_COMMERCIAL_EXPLOITATION (CRITICAL)
  // ──────────────────────────────────────────────────────────────────────────
  const commercialMatches = COMMERCIAL_CTA_PATTERNS.filter((p) => p.test(corpus));

  if (commercialMatches.length === 0) {
    results.push({
      ruleCode: 'COPPA_COMMERCIAL_EXPLOITATION',
      category: 'SAFETY_COMPLIANCE',
      severity: 'CRITICAL',
      status: 'PASS',
      score: 100,
      notes: 'Ausencia de explotación comercial engañosa o llamadas agresivas a la compra orientadas a menores.',
      telemetry: { commercialCtasFound: false },
    });
  } else {
    results.push({
      ruleCode: 'COPPA_COMMERCIAL_EXPLOITATION',
      category: 'SAFETY_COMPLIANCE',
      severity: 'CRITICAL',
      status: 'FAIL',
      score: 0,
      notes: 'Violación de directiva infantil: Se detectaron llamadas a la acción comerciales agresivas o enlaces de compra directa orientados a niños.',
      remediation: 'Eliminar cualquier incitación a la compra de productos, transacciones o suscripciones de pago en el contenido infantil.',
      telemetry: { matchesCount: commercialMatches.length },
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RULE 6: COPPA_INTERACTION_RESTRICTIONS (WARNING)
  // ──────────────────────────────────────────────────────────────────────────
  const interactionMatches = RESTRICTED_INTERACTION_PATTERNS.filter((p) => p.test(corpus));

  if (interactionMatches.length === 0) {
    results.push({
      ruleCode: 'COPPA_INTERACTION_RESTRICTIONS',
      category: 'CONTENT',
      severity: 'WARNING',
      status: 'PASS',
      score: 100,
      notes: 'Diálogos y descripciones adaptados a las restricciones de interacción de YouTube Kids.',
      telemetry: { interactionRestricted: false },
    });
  } else {
    results.push({
      ruleCode: 'COPPA_INTERACTION_RESTRICTIONS',
      category: 'CONTENT',
      severity: 'WARNING',
      status: 'WARNING',
      score: 60,
      notes: 'Aviso de interacción: Se detectaron llamadas a "comentar abajo" o "activar campana", características que YouTube desactiva por ley en vídeos Made for Kids.',
      remediation: 'Sustituir llamadas a comentar por preguntas reflexivas o ganchos educativos ("¿Tú qué harías en su lugar?").',
      telemetry: { matchesCount: interactionMatches.length },
    });
  }

  return results;
}
