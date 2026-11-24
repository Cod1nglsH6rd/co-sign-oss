/**
 * Embed Page — /embed/[token]
 *
 * Renders a minimal fill session UI designed for iframe embedding.
 * No navigation, no footer — just the document viewer and field sidebar.
 * Redesigned to match the new Co-Sign brand with glass-morphism, brand-teal palette.
 *
 * Communicates with parent window via postMessage API.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import SignatureCanvas from '../../components/SignatureCanvas';
import { useNotReadyRecovery } from '../../hooks/useNotReadyRecovery';
import { SUPPORT_EMAIL } from '../../lib/contact';

const getCsrfToken = () => {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)x-csrf-token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
};

const languageLabels = {
  en: 'EN',
  vi: 'VI',
  es: 'ES',
  pt: 'PT',
  fr: 'FR',
  zh: '中文',
  yue: '粵',
  ht: 'HT',
  ne: 'ने',
};

const EMBED_COPY = {
  en: {
    preparing: 'Preparing',
    loadingTitle: 'Loading your document',
    loadingSub: 'We are setting up your fields and guidance.',
    almostReady: 'Your document is almost ready',
    stillPreparingRetry: 'Still preparing. Retry now while we keep this page open.',
    autoRetry: 'We will retry automatically in the background.',
    attempt: 'Attempt',
    nextRetryIn: (seconds) => `next retry in ${seconds}s`,
    retryNow: 'Retry now',
    refresh: 'Refresh',
    unableLoad: 'Unable to load',
    unableOpenLink: 'We could not open this link',
    secureAccess: 'Secure Access',
    verifyIdentity: 'Verify your identity',
    verifyPromptWithLastName: 'Enter the email and last name this link was sent to.',
    verifyPromptNoLastName: 'Enter the email this link was sent to.',
    sentTo: 'Sent to',
    emailAddress: 'Email address',
    lastName: 'Last name',
    recipientConsent: 'I confirm I am the intended recipient and can access this document.',
    needHelp: 'Need help?',
    verificationFailed: 'Verification failed',
    continue: 'Continue',
    complete: 'Complete',
    submittedTitle: 'Submitted!',
    submittedSub: 'Your document has been submitted successfully.',
    fillDocument: 'Fill Document',
    document: 'Document',
    requiredFields: 'required fields',
    secureLink: 'Secure Link',
    requiredCompleted: (filled, total) => `${filled} of ${total} required completed`,
    progress: 'Progress',
    completed: 'completed',
    onlyIncomplete: 'Only incomplete',
    field: 'Field',
    check: 'Check',
    signatureCaptured: 'Signature captured',
    signatureNotStarted: 'Signature not started',
    replaceSignature: 'Replace signature',
    saved: 'Saved',
    submitting: 'Submitting…',
    submitDocument: 'Submit Document',
    saveDraft: 'Save Draft',
    returnBeforeExpire: 'You can return to this link anytime before it expires.',
  },
  vi: {
    preparing: 'Đang chuẩn bị',
    loadingTitle: 'Đang tải tài liệu',
    loadingSub: 'Đang chuẩn bị các trường và hướng dẫn.',
    almostReady: 'Tài liệu sắp sẵn sàng',
    stillPreparingRetry: 'Vẫn đang chuẩn bị. Hãy thử lại ngay trong khi vẫn mở trang này.',
    autoRetry: 'Hệ thống sẽ tự thử lại trong nền.',
    attempt: 'Lần thử',
    nextRetryIn: (seconds) => `thử lại sau ${seconds} giây`,
    retryNow: 'Thử lại ngay',
    refresh: 'Làm mới',
    unableLoad: 'Không thể tải',
    unableOpenLink: 'Không thể mở liên kết này',
    secureAccess: 'Truy cập bảo mật',
    verifyIdentity: 'Xác minh danh tính',
    verifyPromptWithLastName: 'Nhập email và họ của người nhận liên kết này.',
    verifyPromptNoLastName: 'Nhập email của người nhận liên kết này.',
    sentTo: 'Đã gửi tới',
    emailAddress: 'Địa chỉ email',
    lastName: 'Họ',
    recipientConsent: 'Tôi xác nhận tôi là người nhận phù hợp và có quyền truy cập tài liệu này.',
    needHelp: 'Cần hỗ trợ?',
    verificationFailed: 'Xác minh thất bại',
    continue: 'Tiếp tục',
    complete: 'Hoàn tất',
    submittedTitle: 'Đã gửi!',
    submittedSub: 'Tài liệu đã được gửi thành công.',
    fillDocument: 'Điền tài liệu',
    document: 'Tài liệu',
    requiredFields: 'trường bắt buộc',
    secureLink: 'Liên kết bảo mật',
    requiredCompleted: (filled, total) => `${filled}/${total} trường bắt buộc đã hoàn tất`,
    progress: 'Tiến độ',
    completed: 'đã hoàn thành',
    onlyIncomplete: 'Chỉ trường chưa hoàn tất',
    field: 'Trường',
    check: 'Đánh dấu',
    signatureCaptured: 'Đã lưu chữ ký',
    signatureNotStarted: 'Chưa ký',
    replaceSignature: 'Thay chữ ký',
    saved: 'Đã lưu',
    submitting: 'Đang gửi…',
    submitDocument: 'Gửi tài liệu',
    saveDraft: 'Lưu nháp',
    returnBeforeExpire: 'Bạn có thể quay lại liên kết này bất cứ lúc nào trước khi hết hạn.',
  },
  es: {
    preparing: 'Preparando',
    loadingTitle: 'Cargando tu documento',
    loadingSub: 'Estamos preparando tus campos y ayudas.',
    almostReady: 'Tu documento casi está listo',
    stillPreparingRetry: 'Aún se está preparando. Reintenta ahora mientras mantenemos esta página abierta.',
    autoRetry: 'Reintentaremos automáticamente en segundo plano.',
    attempt: 'Intento',
    nextRetryIn: (seconds) => `siguiente intento en ${seconds}s`,
    retryNow: 'Reintentar',
    refresh: 'Actualizar',
    unableLoad: 'No se puede cargar',
    unableOpenLink: 'No pudimos abrir este enlace',
    secureAccess: 'Acceso seguro',
    verifyIdentity: 'Verifica tu identidad',
    verifyPromptWithLastName: 'Ingresa el correo y apellido al que se envió este enlace.',
    verifyPromptNoLastName: 'Ingresa el correo al que se envió este enlace.',
    sentTo: 'Enviado a',
    emailAddress: 'Correo electrónico',
    lastName: 'Apellido',
    recipientConsent: 'Confirmo que soy el destinatario previsto y puedo acceder a este documento.',
    needHelp: '¿Necesitas ayuda?',
    verificationFailed: 'La verificación falló',
    continue: 'Continuar',
    complete: 'Completado',
    submittedTitle: 'Enviado',
    submittedSub: 'Tu documento se envió correctamente.',
    fillDocument: 'Completar documento',
    document: 'Documento',
    requiredFields: 'campos obligatorios',
    secureLink: 'Enlace seguro',
    requiredCompleted: (filled, total) => `${filled} de ${total} obligatorios completados`,
    progress: 'Progreso',
    completed: 'completado',
    onlyIncomplete: 'Solo incompletos',
    field: 'Campo',
    check: 'Marcar',
    signatureCaptured: 'Firma capturada',
    signatureNotStarted: 'Firma sin iniciar',
    replaceSignature: 'Reemplazar firma',
    saved: 'Guardado',
    submitting: 'Enviando…',
    submitDocument: 'Enviar documento',
    saveDraft: 'Guardar borrador',
    returnBeforeExpire: 'Puedes volver a este enlace en cualquier momento antes de que expire.',
  },
  pt: {
    preparing: 'Preparando',
    loadingTitle: 'Carregando seu documento',
    loadingSub: 'Estamos preparando seus campos e orientações.',
    almostReady: 'Seu documento está quase pronto',
    stillPreparingRetry: 'Ainda preparando. Tente novamente agora enquanto mantemos esta página aberta.',
    autoRetry: 'Tentaremos novamente automaticamente em segundo plano.',
    attempt: 'Tentativa',
    nextRetryIn: (seconds) => `próxima tentativa em ${seconds}s`,
    retryNow: 'Tentar novamente',
    refresh: 'Atualizar',
    unableLoad: 'Não foi possível carregar',
    unableOpenLink: 'Não foi possível abrir este link',
    secureAccess: 'Acesso seguro',
    verifyIdentity: 'Verifique sua identidade',
    verifyPromptWithLastName: 'Insira o e-mail e o sobrenome para os quais este link foi enviado.',
    verifyPromptNoLastName: 'Insira o e-mail para o qual este link foi enviado.',
    sentTo: 'Enviado para',
    emailAddress: 'E-mail',
    lastName: 'Sobrenome',
    recipientConsent: 'Confirmo que sou o destinatário pretendido e posso acessar este documento.',
    needHelp: 'Precisa de ajuda?',
    verificationFailed: 'A verificação falhou',
    continue: 'Continuar',
    complete: 'Completo',
    submittedTitle: 'Enviado!',
    submittedSub: 'Seu documento foi enviado com sucesso.',
    fillDocument: 'Preencher documento',
    document: 'Documento',
    requiredFields: 'campos obrigatórios',
    secureLink: 'Link seguro',
    requiredCompleted: (filled, total) => `${filled} de ${total} obrigatórios concluídos`,
    progress: 'Progresso',
    completed: 'concluído',
    onlyIncomplete: 'Somente incompletos',
    field: 'Campo',
    check: 'Marcar',
    signatureCaptured: 'Assinatura capturada',
    signatureNotStarted: 'Assinatura não iniciada',
    replaceSignature: 'Substituir assinatura',
    saved: 'Salvo',
    submitting: 'Enviando…',
    submitDocument: 'Enviar documento',
    saveDraft: 'Salvar rascunho',
    returnBeforeExpire: 'Você pode voltar a este link a qualquer momento antes de expirar.',
  },
  fr: {
    preparing: 'Préparation',
    loadingTitle: 'Chargement de votre document',
    loadingSub: 'Nous préparons vos champs et vos conseils.',
    almostReady: 'Votre document est presque prêt',
    stillPreparingRetry: 'Préparation en cours. Réessayez maintenant pendant que cette page reste ouverte.',
    autoRetry: 'Nous réessaierons automatiquement en arrière-plan.',
    attempt: 'Tentative',
    nextRetryIn: (seconds) => `nouvelle tentative dans ${seconds}s`,
    retryNow: 'Réessayer',
    refresh: 'Actualiser',
    unableLoad: 'Impossible de charger',
    unableOpenLink: 'Nous n’avons pas pu ouvrir ce lien',
    secureAccess: 'Accès sécurisé',
    verifyIdentity: 'Vérifiez votre identité',
    verifyPromptWithLastName: 'Saisissez l’e-mail et le nom de famille auxquels ce lien a été envoyé.',
    verifyPromptNoLastName: 'Saisissez l’e-mail auquel ce lien a été envoyé.',
    sentTo: 'Envoyé à',
    emailAddress: 'Adresse e-mail',
    lastName: 'Nom de famille',
    recipientConsent: 'Je confirme être le destinataire prévu et pouvoir accéder à ce document.',
    needHelp: 'Besoin d’aide ?',
    verificationFailed: 'La vérification a échoué',
    continue: 'Continuer',
    complete: 'Terminé',
    submittedTitle: 'Envoyé !',
    submittedSub: 'Votre document a été envoyé avec succès.',
    fillDocument: 'Remplir le document',
    document: 'Document',
    requiredFields: 'champs obligatoires',
    secureLink: 'Lien sécurisé',
    requiredCompleted: (filled, total) => `${filled} sur ${total} obligatoires remplis`,
    progress: 'Progression',
    completed: 'rempli',
    onlyIncomplete: 'Incomplets seulement',
    field: 'Champ',
    check: 'Cocher',
    signatureCaptured: 'Signature capturée',
    signatureNotStarted: 'Signature non commencée',
    replaceSignature: 'Remplacer la signature',
    saved: 'Enregistré',
    submitting: 'Envoi…',
    submitDocument: 'Envoyer le document',
    saveDraft: 'Enregistrer le brouillon',
    returnBeforeExpire: 'Vous pouvez revenir à ce lien à tout moment avant son expiration.',
  },
  zh: {
    preparing: '正在准备',
    loadingTitle: '正在加载你的文档',
    loadingSub: '我们正在准备字段和指引。',
    almostReady: '你的文档即将就绪',
    stillPreparingRetry: '仍在准备中。请在此页面保持打开时立即重试。',
    autoRetry: '我们会在后台自动重试。',
    attempt: '尝试',
    nextRetryIn: (seconds) => `${seconds} 秒后重试`,
    retryNow: '立即重试',
    refresh: '刷新',
    unableLoad: '无法加载',
    unableOpenLink: '我们无法打开此链接',
    secureAccess: '安全访问',
    verifyIdentity: '验证你的身份',
    verifyPromptWithLastName: '请输入此链接发送到的电子邮件和姓氏。',
    verifyPromptNoLastName: '请输入此链接发送到的电子邮件。',
    sentTo: '发送至',
    emailAddress: '电子邮件',
    lastName: '姓氏',
    recipientConsent: '我确认我是预期的收件人，并且可以访问此文档。',
    needHelp: '需要帮助？',
    verificationFailed: '验证失败',
    continue: '继续',
    complete: '完成',
    submittedTitle: '已提交！',
    submittedSub: '你的文档已成功提交。',
    fillDocument: '填写文档',
    document: '文档',
    requiredFields: '必填字段',
    secureLink: '安全链接',
    requiredCompleted: (filled, total) => `已完成 ${total} 个必填中的 ${filled} 个`,
    progress: '进度',
    completed: '已完成',
    onlyIncomplete: '仅未完成',
    field: '字段',
    check: '勾选',
    signatureCaptured: '签名已捕获',
    signatureNotStarted: '签名未开始',
    replaceSignature: '替换签名',
    saved: '已保存',
    submitting: '正在提交…',
    submitDocument: '提交文档',
    saveDraft: '保存草稿',
    returnBeforeExpire: '在链接过期前，你可以随时返回此链接。',
  },
  yue: {
    preparing: '正在準備',
    loadingTitle: '正在載入你嘅文件',
    loadingSub: '我哋正在準備欄位同指引。',
    almostReady: '你嘅文件就快準備好',
    stillPreparingRetry: '仲喺度準備緊。請喺呢一頁保持開啟時即刻重試。',
    autoRetry: '我哋會喺背景自動重試。',
    attempt: '嘗試',
    nextRetryIn: (seconds) => `${seconds} 秒後重試`,
    retryNow: '即刻重試',
    refresh: '重新整理',
    unableLoad: '無法載入',
    unableOpenLink: '我哋無法開啟呢個連結',
    secureAccess: '安全存取',
    verifyIdentity: '驗證你嘅身份',
    verifyPromptWithLastName: '請輸入呢個連結寄去嘅電郵同姓氏。',
    verifyPromptNoLastName: '請輸入呢個連結寄去嘅電郵。',
    sentTo: '寄去',
    emailAddress: '電郵',
    lastName: '姓氏',
    recipientConsent: '我確認我係指定收件人，並且可以存取呢份文件。',
    needHelp: '需要幫手？',
    verificationFailed: '驗證失敗',
    continue: '繼續',
    complete: '完成',
    submittedTitle: '已提交！',
    submittedSub: '你嘅文件已成功提交。',
    fillDocument: '填寫文件',
    document: '文件',
    requiredFields: '必填欄位',
    secureLink: '安全連結',
    requiredCompleted: (filled, total) => `已完成 ${total} 個必填中嘅 ${filled} 個`,
    progress: '進度',
    completed: '已完成',
    onlyIncomplete: '只限未完成',
    field: '欄位',
    check: '剔選',
    signatureCaptured: '簽名已捕捉',
    signatureNotStarted: '簽名未開始',
    replaceSignature: '更換簽名',
    saved: '已儲存',
    submitting: '正在提交…',
    submitDocument: '提交文件',
    saveDraft: '儲存草稿',
    returnBeforeExpire: '喺連結過期之前，你可以隨時返嚟呢個連結。',
  },
  ht: {
    preparing: 'N ap prepare',
    loadingTitle: 'N ap chaje dokiman w lan',
    loadingSub: 'N ap prepare chan yo ak gid la.',
    almostReady: 'Dokiman w lan prèske pare',
    stillPreparingRetry: 'N ap prepare toujou. Eseye ankò kounye a pandan paj la rete louvri.',
    autoRetry: 'N ap eseye ankò otomatikman an background.',
    attempt: 'Esè',
    nextRetryIn: (seconds) => `pwochen esè nan ${seconds}s`,
    retryNow: 'Eseye ankò',
    refresh: 'Rafrechi',
    unableLoad: 'Pa ka chaje',
    unableOpenLink: 'Nou pa t ka louvri lyen sa a',
    secureAccess: 'Aksè sekirize',
    verifyIdentity: 'Verifye idantite w',
    verifyPromptWithLastName: 'Antre imèl ak siyati yo te voye lyen sa a ba li.',
    verifyPromptNoLastName: 'Antre imèl yo te voye lyen sa a ba li.',
    sentTo: 'Voye bay',
    emailAddress: 'Adrès imèl',
    lastName: 'Siyati',
    recipientConsent: 'Mwen konfime mwen se moun ki sipoze resevwa l la epi mwen ka aksede dokiman sa a.',
    needHelp: 'Bezwen èd?',
    verificationFailed: 'Verifikasyon an echwe',
    continue: 'Kontinye',
    complete: 'Konplè',
    submittedTitle: 'Soumèt!',
    submittedSub: 'Dokiman w lan soumèt avèk siksè.',
    fillDocument: 'Ranpli dokiman an',
    document: 'Dokiman',
    requiredFields: 'chan obligatwa',
    secureLink: 'Lyen sekirize',
    requiredCompleted: (filled, total) => `${filled} sou ${total} obligatwa ranpli`,
    progress: 'Pwogrè',
    completed: 'ranpli',
    onlyIncomplete: 'Sa ki pa konplè sèlman',
    field: 'Chan',
    check: 'Tcheke',
    signatureCaptured: 'Siyati kaptire',
    signatureNotStarted: 'Siyati poko kòmanse',
    replaceSignature: 'Ranplase siyati',
    saved: 'Sove',
    submitting: 'N ap soumèt…',
    submitDocument: 'Soumèt dokiman an',
    saveDraft: 'Sove bouyon',
    returnBeforeExpire: 'Ou ka retounen sou lyen sa a nenpòt lè anvan li ekspire.',
  },
  ne: {
    preparing: 'तयारी हुँदैछ',
    loadingTitle: 'तपाईंको कागजात लोड हुँदैछ',
    loadingSub: 'हामी तपाईंका फिल्ड र मार्गदर्शन तयार गर्दैछौं।',
    almostReady: 'तपाईंको कागजात लगभग तयार छ',
    stillPreparingRetry: 'अझै तयार हुँदैछ। यो पृष्ठ खुला रहँदा अहिले पुनः प्रयास गर्नुहोस्।',
    autoRetry: 'हामी पृष्ठभूमिमा स्वतः पुनः प्रयास गर्नेछौं।',
    attempt: 'प्रयास',
    nextRetryIn: (seconds) => `${seconds}s मा पुनः प्रयास`,
    retryNow: 'अहिले पुनः प्रयास',
    refresh: 'ताजा गर्नुहोस्',
    unableLoad: 'लोड गर्न सकिएन',
    unableOpenLink: 'हामी यो लिङ्क खोल्न सकेनौं',
    secureAccess: 'सुरक्षित पहुँच',
    verifyIdentity: 'तपाईंको परिचय प्रमाणित गर्नुहोस्',
    verifyPromptWithLastName: 'यो लिङ्क पठाइएको इमेल र थर प्रविष्ट गर्नुहोस्।',
    verifyPromptNoLastName: 'यो लिङ्क पठाइएको इमेल प्रविष्ट गर्नुहोस्।',
    sentTo: 'पठाइएको',
    emailAddress: 'इमेल ठेगाना',
    lastName: 'थर',
    recipientConsent: 'म पुष्टि गर्छु कि म लक्षित प्रापक हुँ र यो कागजात पहुँच गर्न सक्छु।',
    needHelp: 'मद्दत चाहियो?',
    verificationFailed: 'प्रमाणीकरण असफल',
    continue: 'जारी राख्नुहोस्',
    complete: 'पूरा',
    submittedTitle: 'पेश गरियो!',
    submittedSub: 'तपाईंको कागजात सफलतापूर्वक पेश गरियो।',
    fillDocument: 'कागजात भर्नुहोस्',
    document: 'कागजात',
    requiredFields: 'अनिवार्य फिल्डहरू',
    secureLink: 'सुरक्षित लिङ्क',
    requiredCompleted: (filled, total) => `${total} अनिवार्य मध्ये ${filled} पूरा`,
    progress: 'प्रगति',
    completed: 'पूरा भयो',
    onlyIncomplete: 'अपूर्ण मात्र',
    field: 'फिल्ड',
    check: 'चिन्ह लगाउनुहोस्',
    signatureCaptured: 'हस्ताक्षर खिचियो',
    signatureNotStarted: 'हस्ताक्षर सुरु भएको छैन',
    replaceSignature: 'हस्ताक्षर बदल्नुहोस्',
    saved: 'सुरक्षित',
    submitting: 'पेश गर्दै…',
    submitDocument: 'कागजात पेश गर्नुहोस्',
    saveDraft: 'मस्यौदा सुरक्षित गर्नुहोस्',
    returnBeforeExpire: 'लिङ्क समाप्त हुनुअघि तपाईं जुनसुकै बेला यो लिङ्कमा फर्कन सक्नुहुन्छ।',
  },
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

const isFilledValue = (fieldType, value, signature) => {
  if (fieldType === 'checkbox') return value === 'true' || value === true;
  if (fieldType === 'signature') return Boolean(signature) || (typeof value === 'string' && value.startsWith('data:image/'));
  return value !== null && value !== undefined && String(value).trim() !== '';
};

const isFieldRequired = (field) => field?.required !== false;
const TERMINAL_SESSION_ERROR_CODES = new Set([
  'invalid_token',
  'session_not_found',
  'not_found',
  'expired',
  'revoked',
  'already_completed',
]);

export default function EmbedPage() {
  const router = useRouter();
  const { token, lang: initialLang } = router.query;

  const [session, setSession] = useState(null);
  const [fields, setFields] = useState([]);
  const [, setProgress] = useState(null);
  const [fieldValues, setFieldValues] = useState({});
  const [language, setLanguage] = useState(initialLang || 'en');
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState(null);
  const [uiError, setUiError] = useState(null);
  const [missingFields, setMissingFields] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [verificationNeedsLastName, setVerificationNeedsLastName] = useState(true);
  const [verificationEmail, setVerificationEmail] = useState('');
  const [verificationLastName, setVerificationLastName] = useState('');
  const [verificationConsent, setVerificationConsent] = useState(false);
  const [verificationToken, setVerificationToken] = useState(null);
  const [maskedEmail, setMaskedEmail] = useState('');
  const [availableLanguages, setAvailableLanguages] = useState(['en']);
  const [notReady, setNotReady] = useState(false);
  const [notReadyMessage, setNotReadyMessage] = useState('');
  const [expandedFields, setExpandedFields] = useState(new Set());
  const [activeFieldId, setActiveFieldId] = useState(null);
  const [showOnlyIncomplete, setShowOnlyIncomplete] = useState(false);
  const ui = EMBED_COPY[language] || EMBED_COPY.en;
  const {
    start: startRecovery,
    retryNow: retryRecoveryNow,
    active: recoveryActive,
    timedOut: recoveryTimedOut,
    attempt: recoveryAttempt,
    secondsUntilNextRetry,
  } = useNotReadyRecovery({
    maxAttempts: 10,
    maxDurationMs: 120000,
  });
  const [parentOrigin, setParentOrigin] = useState(null);
  const parentSourceRef = useRef(null);
  const inFlightLoadRef = useRef(null);
  const inFlightAbortControllerRef = useRef(null);
  const recoveryActiveRef = useRef(false);

  // Notify parent of events
  const postToParent = useCallback((type, payload) => {
    if (typeof window !== 'undefined' && window.parent !== window) {
      const targetOrigin = parentOrigin || (() => {
        try {
          return document.referrer ? new URL(document.referrer).origin : '*';
        } catch {
          return '*';
        }
      })();
      window.parent.postMessage({ type, payload }, targetOrigin || '*');
    }
  }, [parentOrigin]);

  const parseApiResult = useCallback(async (res, fallbackMessage) => {
    let data = null;
    try {
      data = await res.json();
    } catch {}
    if (res.ok) return { ok: true, data };
    return {
      ok: false,
      status: res.status,
      errorCode: data?.errorCode || data?.error || 'request_failed',
      message: data?.message || data?.error || fallbackMessage,
      missingFields: data?.missingFields || [],
    };
  }, []);

  const buildSessionHeaders = useCallback((base = {}) => {
    const csrfToken = getCsrfToken();
    return {
      ...base,
      ...(verificationToken ? { 'x-session-verify': verificationToken } : {}),
      ...(parentOrigin ? { 'x-cosign-parent-origin': parentOrigin } : {}),
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
    };
  }, [parentOrigin, verificationToken]);

  useEffect(() => {
    recoveryActiveRef.current = recoveryActive;
  }, [recoveryActive]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!document.referrer) return;
    try {
      const inferredOrigin = new URL(document.referrer).origin;
      setParentOrigin(inferredOrigin);
    } catch {}
  }, []);

  const focusFieldCard = useCallback((fieldId) => {
    if (!fieldId) return;
    setExpandedFields((prev) => new Set([...prev, fieldId]));
    setActiveFieldId(fieldId);
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        const fieldEl = document.getElementById(`embed-field-${fieldId}`);
        if (fieldEl) fieldEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }, []);

  const abortInFlightSessionLoad = useCallback((reason = 'unknown') => {
    if (!inFlightAbortControllerRef.current) return;
    console.debug('[Embed] Aborting in-flight session load', { reason });
    inFlightAbortControllerRef.current.abort();
    inFlightAbortControllerRef.current = null;
  }, []);

  const loadSession = useCallback(async ({
    preserveDraft = false,
    silent = false,
  } = {}) => {
    if (!token) return { state: 'terminal', errorCode: 'invalid_token', message: 'Missing token' };
    if (inFlightLoadRef.current) {
      console.debug('[Embed] Session load skipped (already in flight)');
      return inFlightLoadRef.current;
    }
    if (!silent) {
      setLoading(true);
      setFatalError(null);
      setUiError(null);
      setMissingFields([]);
    }

    const abortController = new AbortController();
    inFlightAbortControllerRef.current = abortController;

    const loadPromise = (async () => {
      try {
        const storedToken = typeof window !== 'undefined'
          ? sessionStorage.getItem(`cosign_verify_${token}`)
          : null;
        if (storedToken) {
          setVerificationToken(storedToken);
        }

        const res = await fetch(`/api/sessions/${token}`, {
          cache: 'no-store',
          signal: abortController.signal,
          headers: {
            ...(storedToken ? { 'x-session-verify': storedToken } : {}),
            ...(parentOrigin ? { 'x-cosign-parent-origin': parentOrigin } : {}),
            'cache-control': 'no-cache',
          },
        });
        const data = await res.json().catch(() => ({}));
        const errorCode = data?.errorCode || data?.error;

        if (!res.ok || !data.success) {
          if (errorCode === 'not_ready') {
            setNotReady(true);
            setNotReadyMessage(data?.message || 'Not ready yet');
            return { state: 'not_ready', errorCode, message: data?.message || 'Document is still being prepared', status: res.status };
          }

          if (res.status === 429 || res.status >= 500) {
            return { state: 'retry', errorCode: errorCode || 'session_load_failed', message: data?.message || 'Failed to load session', status: res.status };
          }

          const message = data?.message || data?.error || 'Session not found';
          if (!silent) {
            setFatalError(message);
            postToParent('cosign:error', {
              errorCode: errorCode || 'session_load_failed',
              message,
              missingFields: [],
            });
          }

          return {
            state: TERMINAL_SESSION_ERROR_CODES.has(errorCode) ? 'terminal' : 'retry',
            errorCode: errorCode || 'session_load_failed',
            message,
            status: res.status,
          };
        }

        if (data.requiresVerification) {
          setVerificationRequired(true);
          setVerificationNeedsLastName(Boolean(data.requiresLastName));
          setMaskedEmail(data.maskedEmail || '');
          setNotReady(false);
          setNotReadyMessage('');
          return { state: 'ready', requiresVerification: true };
        }

        setNotReady(false);
        setNotReadyMessage('');
        setVerificationRequired(false);
        setSession(data.session);
        setFields(data.fields);
        setProgress(data.fillProgress);

        if (data.session?.embedOrigin) {
          setParentOrigin(data.session.embedOrigin);
        }

        const langs = data.session.availableLanguages || ['en'];
        setAvailableLanguages(langs);
        const sessionPreferredLanguage = data.session.preferredLanguage || data.session.preferred_language || null;
        const nextLanguage = (sessionPreferredLanguage && langs.includes(sessionPreferredLanguage))
          ? sessionPreferredLanguage
          : (langs.includes(initialLang) ? initialLang : (langs[0] || 'en'));
        setLanguage((prev) => {
          if (preserveDraft && prev && langs.includes(prev)) return prev;
          return nextLanguage;
        });

        const existing = {};
        data.fields.forEach((f) => {
          if (f.fieldType === 'signature') {
            if (f.signature) existing[f.id] = f.signature;
            return;
          }
          if (f.currentValue !== null && f.currentValue !== undefined) {
            existing[f.id] = f.currentValue;
          }
        });
        setFieldValues((prev) => (preserveDraft ? { ...existing, ...prev } : existing));

        if (data.session.status === 'completed') {
          setCompleted(true);
        }

        const firstFieldId = data.fields?.[0]?.id;
        if (firstFieldId && !preserveDraft) {
          setExpandedFields(new Set([firstFieldId]));
          setActiveFieldId(firstFieldId);
        }

        postToParent('cosign:ready', {});
        return { state: 'ready' };
      } catch (err) {
        if (err?.name === 'AbortError') {
          return {
            state: 'retry',
            errorCode: 'request_aborted',
            message: 'Session load aborted',
            status: 0,
            aborted: true,
          };
        }
        if (!silent) {
          setFatalError('Failed to load session');
          postToParent('cosign:error', {
            errorCode: 'session_load_failed',
            message: err.message || 'Failed to load session',
            missingFields: [],
          });
        }
        return {
          state: 'retry',
          errorCode: 'session_load_failed',
          message: err.message || 'Failed to load session',
          status: 0,
        };
      } finally {
        if (inFlightAbortControllerRef.current === abortController) {
          inFlightAbortControllerRef.current = null;
        }
        inFlightLoadRef.current = null;
        if (!silent) {
          setLoading(false);
        }
      }
    })();

    inFlightLoadRef.current = loadPromise;
    return loadPromise;
  }, [initialLang, parentOrigin, postToParent, token]);

  const startNotReadyRecovery = useCallback((reason = 'unknown') => {
    if (recoveryActiveRef.current) {
      console.debug('[Embed Recovery] start suppressed (already active)', { reason });
      return;
    }

    recoveryActiveRef.current = true;
    setNotReady(true);
    startRecovery({
      onTry: async () => {
        const outcome = await loadSession({ preserveDraft: true, silent: true });
        if (outcome?.state === 'ready') return { state: 'ready' };
        if (outcome?.state === 'terminal') return { state: 'terminal', message: outcome.message };
        return { state: 'retry', message: outcome?.message || 'Still preparing document...' };
      },
      onRecovered: () => {
        recoveryActiveRef.current = false;
        setNotReady(false);
        setNotReadyMessage('');
        setUiError(null);
      },
      onTerminal: (result) => {
        recoveryActiveRef.current = false;
        setNotReady(false);
        setNotReadyMessage('');
        setFatalError(result?.message || 'Unable to open this link');
        postToParent('cosign:error', {
          errorCode: 'session_load_failed',
          message: result?.message || 'Unable to open this link',
          missingFields: [],
        });
      },
      onTimeout: () => {
        recoveryActiveRef.current = false;
        console.debug('[Embed Recovery] timeout reached');
        setNotReady(true);
        if (!notReadyMessage) setNotReadyMessage(ui.autoRetry);
      },
    });
  }, [loadSession, notReadyMessage, postToParent, startRecovery, ui.autoRetry]);

  // Load session data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const outcome = await loadSession();
      if (cancelled) return;
      if (outcome?.state === 'not_ready') {
        startNotReadyRecovery('initial_load_not_ready');
      }
    })();
    return () => {
      cancelled = true;
      abortInFlightSessionLoad('effect_cleanup');
    };
  }, [abortInFlightSessionLoad, loadSession, reloadKey, startNotReadyRecovery]);

  const handleLanguageChange = useCallback(async (newLang) => {
    setLanguage(newLang);
    try {
      const res = await fetch(`/api/sessions/${token}/language`, {
        method: 'PUT',
        headers: buildSessionHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ language: newLang }),
      });
      const result = await parseApiResult(res, 'Failed to switch language');
      if (!result.ok && result.errorCode === 'not_ready') {
        setUiError('Document is still preparing. We will retry automatically.');
        startNotReadyRecovery('language_change_not_ready');
      }
    } catch {}
  }, [buildSessionHeaders, parseApiResult, startNotReadyRecovery, token]);

  // Listen for parent messages
  useEffect(() => {
    function handleMessage(event) {
      if (!event.data || !event.data.type) return;
      if (typeof window !== 'undefined' && window.parent !== window && event.source !== window.parent) {
        return;
      }

      if (parentOrigin && event.origin !== parentOrigin) {
        return;
      }

      if (!parentOrigin && event.origin && event.origin !== 'null') {
        setParentOrigin(event.origin);
      }

      parentSourceRef.current = event.source || null;
      if (event.data.type === 'cosign:setLanguage') {
        handleLanguageChange(event.data.payload?.language);
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleLanguageChange, parentOrigin]);

  // Resize notification
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const observer = new ResizeObserver(() => {
        postToParent('cosign:resize', { height: document.body.scrollHeight });
      });
      observer.observe(document.body);
      return () => observer.disconnect();
    }
  }, [postToParent]);

  const handleFieldChange = (fieldId, value) => {
    setFieldValues(prev => ({ ...prev, [fieldId]: value }));
    setUiError(null);
    setMissingFields((prev) => prev.filter((field) => String(field.id) !== String(fieldId)));
  };

  const getCurrentFieldValue = useCallback((field) => {
    if (hasOwn(fieldValues, field.id)) return fieldValues[field.id];
    if (field.fieldType === 'signature') return field.signature || '';
    return field.currentValue ?? '';
  }, [fieldValues]);

  const getDisplayFieldName = useCallback((field) => {
    if (!field) return '';
    return field.translations?.[language] || field.fieldName || `Field ${field.id}`;
  }, [language]);

  const getEditableFieldValues = useCallback(() => {
    const payload = {};
    fields.forEach((field) => {
      if (field.fieldType === 'signature') return;
      if (hasOwn(fieldValues, field.id)) {
        payload[field.id] = fieldValues[field.id];
      }
    });
    return payload;
  }, [fields, fieldValues]);

  const upsertLocalSignature = useCallback((fieldId, signatureDataUrl) => {
    setFields((prev) => prev.map((field) => (
      field.id === fieldId
        ? { ...field, signature: signatureDataUrl, currentValue: signatureDataUrl ? '[signature]' : null }
        : field
    )));
  }, []);

  const clearLocalSignatureValue = useCallback((fieldId) => {
    setFieldValues((prev) => {
      if (!hasOwn(prev, fieldId)) return prev;
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  }, []);

  const persistSignatures = useCallback(async () => {
    const signatureFields = fields.filter((field) => field.fieldType === 'signature');
    for (const field of signatureFields) {
      const hasLocalValue = hasOwn(fieldValues, field.id);
      const signatureValue = hasLocalValue ? fieldValues[field.id] : field.signature;
      const shouldClearSignature = hasLocalValue && (signatureValue === '' || signatureValue === null);

      if (shouldClearSignature && field.signature) {
        const res = await fetch(`/api/sessions/${token}/sign`, {
          method: 'POST',
          headers: buildSessionHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            fieldId: field.id,
            signatureDataUrl: null,
          }),
        });
        const result = await parseApiResult(res, 'Failed to clear signature');
        if (!result.ok || !result.data?.success) {
          const error = new Error(result.message || 'Failed to clear signature');
          error.errorCode = result.errorCode;
          throw error;
        }
        upsertLocalSignature(field.id, '');
        clearLocalSignatureValue(field.id);
        continue;
      }

      if (typeof signatureValue !== 'string' || !signatureValue.startsWith('data:image/')) continue;
      if (field.signature === signatureValue) continue;

      const res = await fetch(`/api/sessions/${token}/sign`, {
        method: 'POST',
        headers: buildSessionHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          fieldId: field.id,
          signatureDataUrl: signatureValue,
        }),
      });
      const result = await parseApiResult(res, 'Failed to save signature');
      if (!result.ok || !result.data?.success) {
        const error = new Error(result.message || 'Failed to save signature');
        error.errorCode = result.errorCode;
        throw error;
      }
      upsertLocalSignature(field.id, signatureValue);
    }
  }, [buildSessionHeaders, clearLocalSignatureValue, fieldValues, fields, parseApiResult, token, upsertLocalSignature]);

  const handleSaveDraft = async () => {
    if (savingDraft) return;
    setSavingDraft(true);
    try {
      setUiError(null);
      await persistSignatures();
      const editableFieldValues = getEditableFieldValues();
      if (Object.keys(editableFieldValues).length === 0) return;

      const res = await fetch(`/api/sessions/${token}/fill`, {
        method: 'PUT',
        headers: buildSessionHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ fieldValues: editableFieldValues, saveAsDraft: true }),
      });
      const result = await parseApiResult(res, 'Failed to save');
      if (!result.ok || !result.data?.success) {
        if (result.errorCode === 'not_ready') {
          setUiError('Document is still preparing. We will retry automatically.');
          startNotReadyRecovery('save_draft_not_ready');
          return;
        }
        throw new Error(result.message || 'Failed to save');
      }
      if (result.data.fillProgress) {
        setProgress(prev => ({ ...prev, ...result.data.fillProgress }));
        postToParent('cosign:progress', result.data.fillProgress);
      }
    } catch (err) {
      if (err?.errorCode === 'not_ready') {
        setUiError('Document is still preparing. We will retry automatically.');
        startNotReadyRecovery('save_draft_exception_not_ready');
        return;
      }
      setUiError(err.message || 'Failed to save');
      postToParent('cosign:error', {
        errorCode: 'save_failed',
        message: err.message || 'Failed to save',
        missingFields: [],
      });
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      setUiError(null);
      setMissingFields([]);
      await persistSignatures();
      const editableFieldValues = getEditableFieldValues();
      if (Object.keys(editableFieldValues).length > 0) {
        const fillRes = await fetch(`/api/sessions/${token}/fill`, {
          method: 'PUT',
          headers: buildSessionHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ fieldValues: editableFieldValues, saveAsDraft: false }),
        });
        const fillResult = await parseApiResult(fillRes, 'Unable to save fields');
        if (!fillResult.ok || !fillResult.data?.success) {
          if (fillResult.errorCode === 'not_ready') {
            setUiError('Document is still preparing. We will retry automatically.');
            startNotReadyRecovery('submit_fill_not_ready');
            return;
          }
          setUiError(fillResult.message || 'Unable to save fields');
          postToParent('cosign:error', {
            errorCode: fillResult.errorCode,
            message: fillResult.message || 'Unable to save fields',
            missingFields: fillResult.missingFields || [],
          });
          return;
        }
        if (fillResult.data.fillProgress) {
          setProgress(prev => ({ ...prev, ...fillResult.data.fillProgress }));
        }
      }

      // Complete the session
      const res = await fetch(`/api/sessions/${token}/complete`, {
        method: 'POST',
        headers: buildSessionHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ generatePdf: true }),
      });
      const completeResult = await parseApiResult(res, 'Unable to submit');
      if (completeResult.ok && completeResult.data?.success) {
        setCompleted(true);
        postToParent('cosign:complete', {
          sessionId: completeResult.data.sessionId,
          filledPdfUrl: completeResult.data.filledPdfUrl,
          completedAt: completeResult.data.completedAt,
        });
      } else {
        if (completeResult.errorCode === 'not_ready') {
          setUiError('Document is still preparing. We will retry automatically.');
          startNotReadyRecovery('submit_complete_not_ready');
          return;
        }
        const missing = completeResult.missingFields || [];
        setUiError(completeResult.message || 'Unable to submit');
        if (completeResult.errorCode === 'missing_required_fields' && missing.length > 0) {
          setMissingFields(missing);
          focusFieldCard(missing[0]?.id);
        }
        postToParent('cosign:error', {
          errorCode: completeResult.errorCode,
          message: completeResult.message || 'Unable to submit',
          missingFields: missing,
        });
      }
    } catch (err) {
      if (err?.errorCode === 'not_ready') {
        setUiError('Document is still preparing. We will retry automatically.');
        startNotReadyRecovery('submit_exception_not_ready');
        return;
      }
      setUiError(err.message || 'Unable to submit');
      postToParent('cosign:error', {
        errorCode: 'request_failed',
        message: err.message || 'Unable to submit',
        missingFields: [],
      });
    } finally {
      setSubmitting(false);
    }
  };

  const requiredFields = fields.filter((field) => isFieldRequired(field));
  const filledCount = requiredFields.filter((field) =>
    isFilledValue(field.fieldType, getCurrentFieldValue(field), field.signature)
  ).length;
  const totalCount = requiredFields.length;
  const progressPct = totalCount > 0 ? Math.min((filledCount / totalCount) * 100, 100) : 0;
  const incompleteFields = requiredFields.filter((field) =>
    !isFilledValue(field.fieldType, getCurrentFieldValue(field), field.signature)
  );
  const fieldsToRender = showOnlyIncomplete ? incompleteFields : fields;
  const missingFieldIdSet = new Set(missingFields.map((field) => String(field.id)));

  const toggleField = (fieldId) => {
    setExpandedFields(prev => {
      const next = new Set(prev);
      if (next.has(fieldId)) {
        next.delete(fieldId);
      } else {
        next.add(fieldId);
      }
      return next;
    });
    setActiveFieldId(fieldId);
  };

  const getFieldStatus = (field) => {
    const currentValue = getCurrentFieldValue(field);
    const isFilled = isFilledValue(field.fieldType, currentValue, field.signature);
    if (activeFieldId === field.id) return 'current';
    if (isFilled) return 'done';
    return 'empty';
  };

  // ======== RENDER ========

  if (loading) {
    return (
      <div className="cs-center">
        <div className="cs-state-card">
          <div className="cs-state-badge">{ui.preparing}</div>
          <div className="cs-state-title">{ui.loadingTitle}</div>
          <div className="cs-state-sub">{ui.loadingSub}</div>
          <div className="cs-state-bar"><span /></div>
        </div>
        <style jsx>{styles}</style>
      </div>
    );
  }

  if (notReady) {
    const compactNotReady = String(notReadyMessage || '').toLowerCase().includes('not ready yet');
    return (
      <div className="cs-center">
        <div className="cs-state-card">
          <div className="cs-state-badge">{ui.preparing}</div>
          <div className="cs-state-title">{compactNotReady ? (notReadyMessage || 'Not ready yet') : ui.almostReady}</div>
          {!compactNotReady && (
            <>
              <div className="cs-state-sub">
                {recoveryTimedOut
                  ? ui.stillPreparingRetry
                  : ui.autoRetry}
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--slateish-500)' }}>
                {ui.attempt} {Math.max(recoveryAttempt, 1)}
                {recoveryActive && secondsUntilNextRetry !== null
                  ? ` · ${ui.nextRetryIn(secondsUntilNextRetry)}`
                  : ''}
              </div>
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center', gap: 8 }}>
                <button className="cs-compact-btn" onClick={() => (recoveryActive ? retryRecoveryNow() : startNotReadyRecovery('manual_retry'))}>
                  {ui.retryNow}
                </button>
                <button className="cs-compact-btn" onClick={() => loadSession({ preserveDraft: true })}>
                  {ui.refresh}
                </button>
              </div>
            </>
          )}
        </div>
        <style jsx>{styles}</style>
      </div>
    );
  }

  if (fatalError) {
    return (
      <div className="cs-center">
        <div className="cs-state-card danger">
          <div className="cs-state-badge danger">{ui.unableLoad}</div>
          <div className="cs-state-title">{ui.unableOpenLink}</div>
          <div className="cs-state-sub">{fatalError}</div>
        </div>
        <style jsx>{styles}</style>
      </div>
    );
  }

  if (verificationRequired) {
    const canContinueVerify = Boolean(verificationConsent && verificationEmail && (!verificationNeedsLastName || verificationLastName));

    return (
      <div className="cs-center">
        <div className="cs-verify-card">
          <div className="cs-verify-badge">
            <span className="cs-dot" />
            {ui.secureAccess}
          </div>
          <div className="cs-verify-title">{ui.verifyIdentity}</div>
          <div className="cs-verify-sub">
            {verificationNeedsLastName ? ui.verifyPromptWithLastName : ui.verifyPromptNoLastName}
          </div>
          {uiError && <div className="cs-error-banner verify">{uiError}</div>}
          {maskedEmail && <div className="cs-verify-hint">{ui.sentTo}: {maskedEmail}</div>}

          <div className="cs-verify-form">
            <label>
              {ui.emailAddress}
              <input type="email" placeholder="name@example.com" value={verificationEmail} onChange={(e) => setVerificationEmail(e.target.value)} />
            </label>
            {verificationNeedsLastName && (
              <label>
                {ui.lastName}
                <input type="text" placeholder={ui.lastName} value={verificationLastName} onChange={(e) => setVerificationLastName(e.target.value)} />
              </label>
            )}
            <div className="cs-verify-consent">
              <input type="checkbox" checked={verificationConsent} onChange={(e) => setVerificationConsent(e.target.checked)} />
              <span>{ui.recipientConsent}</span>
            </div>
          </div>

          <div className="cs-verify-actions">
            <a
              className="cs-verify-help"
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Co Sign Embed Link Help')}`}
            >
              {ui.needHelp}
            </a>
            <button
              className="cs-btn-primary"
              onClick={async () => {
                try {
                  const res = await fetch(`/api/sessions/${token}/verify`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      ...(parentOrigin ? { 'x-cosign-parent-origin': parentOrigin } : {}),
                    },
                    body: JSON.stringify({
                      email: verificationEmail,
                      ...(verificationNeedsLastName ? { lastName: verificationLastName } : {}),
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok) {
                    setUiError(data.error || ui.verificationFailed);
                    postToParent('cosign:error', {
                      errorCode: data.errorCode || data.error || 'verification_failed',
                      message: data.message || data.error || ui.verificationFailed,
                      missingFields: [],
                    });
                    return;
                  }
                  setVerificationToken(data.verificationToken);
                  if (typeof window !== 'undefined') {
                    sessionStorage.setItem(`cosign_verify_${token}`, data.verificationToken);
                  }
                  setVerificationRequired(false);
                  setLoading(true);
                  setReloadKey((prev) => prev + 1);
                  setUiError(null);
                } catch (err) {
                  setUiError(ui.verificationFailed);
                  postToParent('cosign:error', {
                    errorCode: 'verification_failed',
                    message: ui.verificationFailed,
                    missingFields: [],
                  });
                }
              }}
              disabled={!canContinueVerify}
            >
              {ui.continue} →
            </button>
          </div>
        </div>
        <style jsx>{styles}</style>
      </div>
    );
  }

  if (completed) {
    return (
      <div className="cs-center">
        <div className="cs-state-card success">
          <div className="cs-state-badge success">{ui.complete}</div>
          <div className="cs-state-title">{ui.submittedTitle}</div>
          <div className="cs-state-sub">{ui.submittedSub}</div>
        </div>
        <style jsx>{styles}</style>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{session?.documentName || ui.fillDocument} — Co Sign</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column' }}>
        {uiError && (
          <div className="cs-error-banner">
            <div>{uiError}</div>
            {missingFields.length > 0 && (
              <div className="cs-error-missing">
                {missingFields.map((field) => (
                  <button
                    key={field.id}
                    type="button"
                    onClick={() => focusFieldCard(field.id)}
                    className="cs-error-pill"
                  >
                    {(() => {
                      const matchingField = fields.find((f) => String(f.id) === String(field.id));
                      return getDisplayFieldName(matchingField || field);
                    })()}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {/* Topbar */}
        <header className="cs-topbar embed">
          <div className="cs-topbar-info">
            <h2>{session?.documentName || ui.document}</h2>
            <div className="cs-topbar-meta">
              <span>{totalCount} {ui.requiredFields}</span>
              <span className="cs-method-pill">
                <span className="cs-dot" />
                {ui.secureLink}
              </span>
              <span>{ui.requiredCompleted(filledCount, totalCount)}</span>
            </div>
          </div>
          <div className="cs-topbar-divider" />
          <div className="cs-lang-toggle">
            {availableLanguages.map((lang) => (
              <button
                key={lang}
                onClick={() => handleLanguageChange(lang)}
                className={language === lang ? 'active' : ''}
              >
                {languageLabels[lang] || lang.toUpperCase()}
              </button>
            ))}
          </div>
        </header>

        {/* Sidebar */}
        <aside className="cs-sidebar embed">
          <div className="cs-sidebar-progress">
            <div className="cs-sidebar-progress-top">
              <span>{ui.progress}</span>
              <span className="cs-completed">{filledCount} {ui.completed}</span>
            </div>
            <div className="cs-progress-bar">
              <div className="cs-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="cs-sidebar-tools">
              <label>
                <input
                  type="checkbox"
                  checked={showOnlyIncomplete}
                  onChange={(event) => setShowOnlyIncomplete(event.target.checked)}
                />
                <span>{ui.onlyIncomplete}</span>
              </label>
            </div>
          </div>

          <div className="cs-fields-list">
            {fieldsToRender.map((field, index) => {
              const isExpanded = expandedFields.has(field.id);
              const status = getFieldStatus(field);
              const currentValue = getCurrentFieldValue(field);
              const isMissing = missingFieldIdSet.has(String(field.id));
              const translation = getDisplayFieldName(field);
              return (
                <div
                  id={`embed-field-${field.id}`}
                  key={field.id}
                  className={`cs-field ${isExpanded ? 'expanded' : ''} ${status === 'done' ? 'done' : ''} ${status === 'current' ? 'current' : ''} ${isMissing ? 'missing' : ''}`}
                >
                  <div className="cs-field-header" onClick={() => toggleField(field.id)}>
                    <div className={`cs-field-dot ${status}`}>
                      {status === 'done' ? '✓' : status === 'current' ? '•' : ''}
                    </div>
                    <div className="cs-field-label">
                      <h4>{translation}</h4>
                      <span>{ui.field} #{index + 1}</span>
                    </div>
                    <div className="cs-field-chevron">⌄</div>
                  </div>
                  <div className="cs-field-body">
                    {field.explanation && (
                      <div className="cs-field-explain">{field.explanation}</div>
                    )}
                    {field.fieldType === 'checkbox' ? (
                      <div className="cs-checkbox-row">
                        <div
                          className={`cs-checkbox ${currentValue === 'true' || currentValue === true ? 'checked' : ''}`}
                          onClick={() => handleFieldChange(field.id, currentValue === 'true' || currentValue === true ? 'false' : 'true')}
                        >
                          {currentValue === 'true' || currentValue === true ? '✓' : ''}
                        </div>
                        <span>
                          {ui.check}
                        </span>
                      </div>
                    ) : field.fieldType === 'signature' ? (
                      <div className="cs-signature-area">
                        <p className="cs-signature-status">
                          {currentValue ? ui.signatureCaptured : ui.signatureNotStarted}
                        </p>
                        <SignatureCanvas
                          value={typeof currentValue === 'string' && currentValue.startsWith('data:image/')
                            ? currentValue
                            : (field.signature || '')}
                          onChange={(value) => handleFieldChange(field.id, value)}
                        />
                        {currentValue && (
                          <button
                            type="button"
                            className="cs-link-btn"
                            onClick={() => handleFieldChange(field.id, '')}
                          >
                            {ui.replaceSignature}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="cs-input-wrap">
                        <input
                          type={field.fieldType === 'date' ? 'date' : field.fieldType === 'email' ? 'email' : field.fieldType === 'tel' ? 'tel' : 'text'}
                          value={currentValue || ''}
                          onChange={(e) => handleFieldChange(field.id, e.target.value)}
                          placeholder={translation}
                        />
                        {currentValue && (
                          <div className="cs-saved">{ui.saved}</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="cs-sidebar-footer">
            <button className="cs-btn-primary full" onClick={handleSubmit} disabled={submitting}>
              {submitting ? ui.submitting : ui.submitDocument}
            </button>
            <button className="cs-btn-outline full" onClick={handleSaveDraft} disabled={savingDraft}>{savingDraft ? ui.saved : ui.saveDraft}</button>
            <div className="cs-help">{ui.returnBeforeExpire}</div>
          </div>
        </aside>
      </div>

      <style jsx>{styles}</style>
    </>
  );
}

export async function getServerSideProps() {
  // Framing headers for /embed are set in middleware.js (per-session
  // frame-ancestors based on the session's embed_origin).
  return { props: {} };
}

const styles = `
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

  :global(body) {
    font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
    color: #2b3338;
    background: #f7f9fa;
    -webkit-font-smoothing: antialiased;
  }

  :global(:root) {
    --brand-50: #e8f5f7; --brand-100: #c7e6ee; --brand-200: #9fd2e1;
    --brand-300: #6fb9cf; --brand-400: #3fa0bd; --brand-500: #1c7e9d;
    --brand-600: #166a86; --brand-700: #11566e; --brand-800: #0b4357; --brand-900: #073244;
    --sl-50: #f7f9fa; --sl-100: #eef1f3; --sl-200: #dde3e7;
    --sl-300: #c6d0d6; --sl-400: #9aa7b0; --sl-500: #6f7b84;
    --sl-600: #556068; --sl-700: #3f4950; --sl-800: #2b3338; --sl-900: #1c2226;
    --emerald-50: #ecfdf5; --emerald-600: #059669;
    --red-50: #fef2f2; --red-500: #ef4444;
    --blue-50: #eff6ff; --blue-500: #3b82f6;
    --amber-50: #fffbeb; --amber-500: #f59e0b;
    --r: 9999px; --r-xl: 28px; --r-lg: 20px; --r-md: 14px; --r-sm: 10px;
  }

  .cs-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--brand-500); flex-shrink: 0; }

  .cs-center {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background:
      radial-gradient(circle at 10% 10%, rgba(28,126,157,0.12), transparent 45%),
      radial-gradient(circle at 90% 20%, rgba(111,185,207,0.16), transparent 45%),
      linear-gradient(160deg, #fff 0%, #f6fbfc 35%, #e8f5f7 75%, #fff 100%);
    padding: 24px;
  }

  .cs-state-card {
    max-width: 440px; width: 100%;
    background: rgba(255,255,255,.82); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
    border: 1px solid var(--brand-100); border-radius: var(--r-xl);
    box-shadow: 0 8px 40px rgba(28,126,157,.08); padding: 36px 32px; text-align: center;
  }
  .cs-state-card.danger { border-color: rgba(239,68,68,.2); }
  .cs-state-card.success { border-color: var(--brand-200); }
  .cs-state-badge {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 5px 14px; border-radius: var(--r);
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px;
    background: var(--brand-50); color: var(--brand-600); border: 1px solid var(--brand-100);
  }
  .cs-state-badge.danger { background: var(--red-50); color: var(--red-500); border-color: rgba(239,68,68,.15); }
  .cs-state-badge.success { background: var(--emerald-50); color: var(--emerald-600); border-color: rgba(5,150,105,.15); }
  .cs-state-title { margin-top: 16px; font-size: 22px; font-weight: 800; color: var(--sl-900); }
  .cs-state-sub { margin-top: 8px; font-size: 14px; color: var(--sl-500); line-height: 1.5; }
  .cs-compact-btn {
    border: 1px solid var(--sl-200);
    background: #fff;
    color: var(--sl-700);
    border-radius: var(--r-md);
    padding: 7px 10px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .cs-compact-btn:hover {
    border-color: var(--brand-300);
    color: var(--brand-700);
  }
  .cs-state-bar { margin-top: 24px; height: 4px; border-radius: 2px; background: var(--sl-100); overflow: hidden; }
  .cs-state-bar span {
    display: block; width: 40%; height: 100%;
    background: linear-gradient(90deg, var(--brand-400), var(--brand-500));
    border-radius: 2px; animation: cs-pulse 1.5s ease-in-out infinite;
  }
  @keyframes cs-pulse { 0%,100%{transform:translateX(-100%)} 50%{transform:translateX(250%)} }

  .cs-error-banner {
    margin: 10px 16px 0;
    padding: 10px 12px;
    border-radius: var(--r-md);
    border: 1px solid rgba(239,68,68,.2);
    background: var(--red-50);
    color: #b91c1c;
    font-size: 13px;
    font-weight: 600;
  }
  .cs-error-missing {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .cs-error-pill {
    border: 1px solid rgba(239,68,68,.25);
    background: #fff;
    color: #b91c1c;
    border-radius: var(--r);
    font-size: 11px;
    font-weight: 600;
    padding: 4px 8px;
    cursor: pointer;
  }
  .cs-error-banner.verify { margin: 14px 0 0; }

  /* ===== VERIFY ===== */
  .cs-verify-card {
    width: 100%; max-width: 480px;
    background: rgba(255,255,255,.82); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
    border: 1px solid var(--brand-100); border-radius: var(--r-xl);
    box-shadow: 0 8px 40px rgba(28,126,157,.08); padding: 32px;
  }
  .cs-verify-badge {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 5px 14px; border-radius: var(--r);
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px;
    background: var(--brand-50); color: var(--brand-600); border: 1px solid var(--brand-100);
  }
  .cs-verify-title { margin-top: 16px; font-size: 22px; font-weight: 800; color: var(--sl-900); }
  .cs-verify-sub { margin-top: 6px; font-size: 14px; color: var(--sl-500); line-height: 1.5; }
  .cs-verify-hint {
    margin-top: 14px; padding: 10px 14px; border-radius: var(--r-md);
    background: var(--sl-50); border: 1px solid var(--sl-200);
    font-size: 13px; color: var(--sl-600);
  }
  .cs-verify-form { margin-top: 20px; display: grid; gap: 14px; }
  .cs-verify-form label { font-size: 13px; color: var(--sl-600); font-weight: 600; display: grid; gap: 6px; }
  .cs-verify-form input[type="email"],
  .cs-verify-form input[type="text"] {
    width: 100%; padding: 12px 14px; border-radius: var(--r-md);
    border: 1px solid var(--sl-200); font-size: 14px; font-family: inherit;
    color: var(--sl-800); background: rgba(255,255,255,.6); transition: all .2s;
  }
  .cs-verify-form input:focus {
    outline: none; border-color: var(--brand-400);
    box-shadow: 0 0 0 4px rgba(28,126,157,.1); background: #fff;
  }
  .cs-verify-consent {
    display: flex; align-items: flex-start; gap: 10px;
    font-size: 12px; color: var(--sl-600); line-height: 1.5;
    background: var(--brand-50); border: 1px solid var(--brand-100);
    padding: 12px 14px; border-radius: var(--r-md);
  }
  .cs-verify-consent input { margin-top: 2px; accent-color: var(--brand-500); }
  .cs-verify-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 20px; }
  .cs-verify-help { font-size: 13px; color: var(--sl-400); text-decoration: none; }
  .cs-verify-help:hover { color: var(--brand-600); }

  /* --- Shared Buttons --- */
  .cs-btn-primary {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    padding: 11px 22px; border-radius: var(--r);
    background: var(--brand-600); color: #fff;
    font-size: 14px; font-weight: 700; font-family: inherit; border: none;
    cursor: pointer; transition: all .2s;
  }
  .cs-btn-primary:hover { background: var(--brand-700); }
  .cs-btn-primary:disabled { background: var(--brand-200); cursor: not-allowed; }
  .cs-btn-primary.full { width: 100%; padding: 14px; box-shadow: 0 2px 8px rgba(22,106,134,.2); }
  .cs-btn-primary.full:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(22,106,134,.3); }
  .cs-btn-outline {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    padding: 11px 22px; border-radius: var(--r);
    border: 1px solid var(--sl-200); background: #fff; color: var(--sl-600);
    font-size: 14px; font-weight: 600; font-family: inherit; cursor: pointer; transition: all .2s;
  }
  .cs-btn-outline:hover { border-color: var(--brand-300); background: var(--brand-50); color: var(--brand-700); }
  .cs-btn-outline.full { width: 100%; padding: 11px; }
  .cs-btn-ghost {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 14px; border-radius: var(--r);
    border: 1px solid var(--sl-200); background: #fff; color: var(--sl-600);
    font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer;
  }
  .cs-btn-ghost:hover { background: var(--sl-50); border-color: var(--sl-300); }

  /* ===== TOPBAR (Glass) ===== */
  .cs-topbar {
    height: 60px; background: rgba(255,255,255,.82);
    backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
    border-bottom: 1px solid var(--sl-100);
    display: flex; align-items: center; padding: 0 20px; gap: 14px;
    position: relative; z-index: 50; flex-shrink: 0;
  }
  .cs-topbar.embed { padding: 0 16px; }
  .cs-topbar-info { flex: 1; min-width: 0; }
  .cs-topbar-info h2 {
    font-size: 14px; font-weight: 700; color: var(--sl-900);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .cs-topbar-meta { display: flex; align-items: center; gap: 10px; margin-top: 2px; }
  .cs-topbar-meta span { font-size: 11px; color: var(--sl-400); }
  .cs-method-pill {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 2px 10px; border-radius: var(--r);
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px;
    background: var(--brand-50); color: var(--brand-600); border: 1px solid var(--brand-100);
  }
  .cs-topbar-divider { width: 1px; height: 28px; background: var(--sl-200); }
  .cs-lang-toggle {
    display: flex; border: 1px solid var(--sl-200); border-radius: var(--r); overflow: hidden;
  }
  .cs-lang-toggle button {
    padding: 6px 14px; border: none; background: #fff; cursor: pointer;
    font-size: 12px; font-weight: 600; color: var(--sl-500); transition: all .2s; font-family: inherit;
  }
  .cs-lang-toggle button.active { background: var(--brand-600); color: #fff; }
  .cs-lang-toggle button:hover:not(.active) { background: var(--sl-50); }

  /* --- Sidebar --- */
  .cs-sidebar {
    width: 420px; background: #fff;
    border-left: 1px solid var(--sl-100);
    display: flex; flex-direction: column; flex-shrink: 0; overflow: hidden;
  }
  .cs-sidebar.embed { width: 100%; border-left: none; border-top: 1px solid var(--sl-100); }

  .cs-sidebar-progress {
    padding: 16px 20px; border-bottom: 1px solid var(--sl-100); flex-shrink: 0;
  }
  .cs-sidebar-progress-top {
    display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
  }
  .cs-sidebar-progress-top span { font-size: 12px; font-weight: 600; color: var(--sl-600); }
  .cs-completed { color: var(--brand-600) !important; }
  .cs-progress-bar {
    height: 6px; border-radius: 3px; background: var(--sl-100); overflow: hidden;
  }
  .cs-progress-fill {
    height: 100%; border-radius: 3px;
    background: linear-gradient(90deg, var(--brand-400), var(--brand-500));
    transition: width .5s;
  }
  .cs-sidebar-tools {
    margin-top: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .cs-sidebar-tools label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--sl-600);
  }
  .cs-sidebar-tools label input {
    accent-color: var(--brand-500);
  }
  .cs-sidebar-tools button {
    border: 1px solid var(--sl-200);
    border-radius: var(--r);
    background: #fff;
    color: var(--sl-700);
    font-size: 11px;
    font-weight: 600;
    padding: 4px 8px;
    cursor: pointer;
  }
  .cs-sidebar-tools button:disabled {
    opacity: .5;
    cursor: not-allowed;
  }

  /* --- Field Cards --- */
  .cs-fields-list { flex: 1; overflow-y: auto; padding: 12px; }
  .cs-field {
    border: 1px solid var(--sl-100); border-radius: var(--r-lg);
    margin-bottom: 8px; overflow: hidden; transition: all .3s;
  }
  .cs-field:hover { border-color: var(--sl-200); }
  .cs-field.current { border-color: var(--brand-400); box-shadow: 0 0 0 3px rgba(28,126,157,.1); }
  .cs-field.done { border-color: var(--brand-200); }
  .cs-field.missing { border-color: rgba(239,68,68,.45); box-shadow: 0 0 0 2px rgba(239,68,68,.15); }
  .cs-field-header {
    display: flex; align-items: center; gap: 10px;
    padding: 14px 16px; cursor: pointer;
  }
  .cs-field-dot {
    width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; transition: all .2s;
  }
  .cs-field-dot.empty { border: 2px solid var(--sl-300); }
  .cs-field-dot.done { background: var(--brand-500); color: #fff; border: none; }
  .cs-field-dot.current { border: 2px solid var(--brand-500); background: var(--brand-50); color: var(--brand-600); }
  .cs-field-label { flex: 1; min-width: 0; }
  .cs-field-label h4 { font-size: 13px; font-weight: 600; color: var(--sl-900); margin-bottom: 1px; }
  .cs-field-label span { font-size: 12px; color: var(--brand-600); font-weight: 500; }
  .cs-field-chevron {
    width: 24px; height: 24px; border-radius: var(--r-sm);
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; color: var(--sl-400); transition: transform .2s;
  }
  .cs-field.expanded .cs-field-chevron { transform: rotate(180deg); }

  .cs-field-body { padding: 0 16px 16px; display: none; }
  .cs-field.expanded .cs-field-body { display: block; }
  .cs-field-explain {
    padding: 12px 14px; border-radius: var(--r-md);
    background: var(--brand-50); border: 1px solid var(--brand-100);
    font-size: 14px; color: var(--sl-600); line-height: 1.65; margin-bottom: 12px;
  }
  .cs-input-wrap { position: relative; }
  .cs-input-wrap input {
    width: 100%; padding: 12px 14px; border-radius: var(--r-md);
    border: 1.5px solid var(--sl-200); font-size: 14px; font-family: inherit;
    color: var(--sl-900); transition: all .2s; outline: none; background: #fff;
  }
  .cs-input-wrap input:focus {
    border-color: var(--brand-400); box-shadow: 0 0 0 3px rgba(28,126,157,.1);
  }
  .cs-input-wrap input::placeholder { color: var(--sl-400); }
  .cs-input-hint { font-size: 11px; color: var(--sl-400); margin-top: 6px; }
  .cs-saved { display: inline-flex; font-size: 11px; color: var(--brand-500); font-weight: 600; margin-top: 6px; }

  .cs-signature-area {
    width: 100%;
  }
  .cs-signature-status {
    font-size: 11px;
    color: var(--sl-600);
    margin-bottom: 8px;
  }
  .cs-link-btn {
    margin-top: 8px;
    border: none;
    background: transparent;
    color: var(--brand-700);
    font-size: 11px;
    font-weight: 600;
    padding: 0;
    cursor: pointer;
  }

  .cs-checkbox-row { display: flex; align-items: center; gap: 12px; }
  .cs-checkbox {
    width: 24px; height: 24px; border-radius: 8px;
    border: 2px solid var(--sl-300); background: #fff;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; transition: all .2s; font-size: 14px;
  }
  .cs-checkbox.checked { background: var(--brand-600); border-color: var(--brand-600); color: #fff; }
  .cs-checkbox-row span { font-size: 14px; color: var(--sl-700); cursor: pointer; }

  .cs-sidebar-footer {
    padding: 16px 20px; border-top: 1px solid var(--sl-100); flex-shrink: 0;
  }
  .cs-sidebar-footer .cs-btn-outline { margin-top: 10px; }
  .cs-help { font-size: 11px; color: var(--sl-400); text-align: center; margin-top: 10px; }

  @media (max-width: 1024px) {
    .cs-sidebar { width: 100%; border-left: none; border-top: 1px solid var(--sl-200); }
  }
  @media (max-width: 768px) {
    .cs-topbar { flex-wrap: wrap; height: auto; padding: 12px; }
    .cs-topbar-divider { display: none; }
    .cs-lang-toggle { width: 100%; }
    .cs-lang-toggle button { flex: 1; }
  }
`;
