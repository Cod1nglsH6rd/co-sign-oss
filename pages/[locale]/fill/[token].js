/**
 * Fill Page — /[locale]/fill/[token]
 *
 * Full-page customer signing experience with verification gate.
 * 2-stage flow: verify → fill
 * Tailwind CSS — mirrors the document viewer (pages/[locale]/documents/[id].js)
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import SignatureCanvas from '../../../components/SignatureCanvas';
import { useNotReadyRecovery } from '../../../hooks/useNotReadyRecovery';
import { SUPPORT_EMAIL } from '../../../lib/contact';
import {
  FiDownload, FiSend, FiMessageCircle, FiList,
  FiLoader, FiCheck, FiFileText, FiGlobe, FiChevronDown, FiChevronUp
} from 'react-icons/fi';

const PdfViewer = dynamic(() => import('../../../components/PdfViewer'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center bg-slateish-50">
      <FiLoader className="w-8 h-8 text-slateish-400 animate-spin" />
    </div>
  ),
});

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'pt', label: 'Português', flag: '🇧🇷' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'zh', label: '中文（普通话）', flag: '🇨🇳' },
  { code: 'yue', label: '粵語', flag: '🇭🇰' },
  { code: 'ht', label: 'Kreyòl Ayisyen', flag: '🇭🇹' },
  { code: 'ne', label: 'नेपाली', flag: '🇳🇵' },
];

const SUPPORTED_UI_LANGUAGES = ['en', 'vi', 'es', 'pt', 'fr', 'zh', 'yue', 'ht', 'ne'];

const UI_COPY = {
  en: {
    chatWelcome: 'Hi! I can help you understand each field. Click the chat icon next to any field to ask me about it.',
    loadingTitle: 'Loading your document',
    loadingSubtitle: 'Setting up your fields and guidance.',
    unableToOpen: 'Unable to open this link',
    almostReady: 'Almost ready',
    expected: { number: 'Expected: numbers only', date: 'Expected: date', email: 'Expected: email address', tel: 'Expected: phone number', text: 'Expected: text' },
    loadingDocument: 'Loading document…',
    pageLabel: (c, t) => `Page ${c} of ${t}`,
    nextField: 'Next field',
    searchFields: 'Search fields…',
    requiredOnly: 'Required only',
    nextRequired: 'Next required field',
    stillPreparingRetry: 'Still preparing. You can retry now while we keep this page open.',
    autoRetryPreparing: 'Your document is being prepared. We will retry automatically.',
    attemptLabel: 'Attempt',
    nextRetryIn: (seconds) => `next retry in ${seconds}s`,
    retryNow: 'Retry now',
    refresh: 'Refresh',
    documentSubmitted: 'Document Submitted',
    documentSubmittedBody: 'Your document has been submitted successfully. You may close this page.',
    fillDocument: 'Fill Document',
    secureAccess: 'Secure Access',
    verifyAccess: 'Verify your access',
    verifyPromptWithLastName: 'Enter the email and last name this link was sent to.',
    verifyPromptNoLastName: 'Enter the email this link was sent to.',
    changeLanguage: 'Change language',
    sentTo: 'Sent to',
    emailAddress: 'Email address',
    lastName: 'Last name',
    intendedRecipientConfirm: 'I confirm I am the intended recipient and can access this document.',
    needHelp: 'Need help?',
    continue: 'Continue',
    document: 'Document',
    requiredProgress: (filled, total) => `${filled} of ${total} required fields completed`,
    saveDraft: 'Save Draft',
    submitting: 'Submitting...',
    submit: 'Submit',
    missingFields: 'Missing fields:',
    documentUnavailable: 'Document unavailable',
    documentUnavailableBody: 'We could not access this document. Please try again.',
    retryLoading: 'Retry loading',
    unableToLoadDocument: 'Unable to load document',
    fieldsTab: 'Fields',
    chatTab: 'Chat',
    completedCount: (filled, total) => `${filled} of ${total} completed`,
    remainingCount: (remaining) => `${remaining} remaining`,
    checklistTitle: 'Ready to submit checklist',
    checklistDone: 'Complete',
    checklistLeft: (count) => `${count} left`,
    required: 'Required',
    signatures: 'Signatures',
    showOnlyIncomplete: 'Show only incomplete',
    unmappedFields: (count) => `${count} field${count > 1 ? 's are' : ' is'} not mapped on PDF preview.`,
    unmappedHint: 'You can still fill and submit these fields.',
    noIncompleteFields: 'No incomplete fields',
    noFieldsDetected: 'No fields detected',
    allFieldsComplete: 'All fields are currently complete.',
    noFormFields: 'This document may not contain form fields.',
    needsAttention: 'Needs attention',
    fieldLabel: 'Field',
    statusDone: 'Done',
    statusRequired: 'Required',
    statusEmpty: 'Empty',
    signatureStatus: 'Signature status:',
    signatureCaptured: 'captured',
    signatureNotStarted: 'not started',
    replaceSignature: 'Replace signature',
    saved: 'Saved',
    askAssistant: 'Ask Cô',
    completedSection: 'Completed',
    signatureCapturedShort: 'Signature captured.',
    valueLabel: (value) => `Value: ${value}`,
    checked: 'Checked',
    unchecked: 'Unchecked',
    savedFallback: 'Saved',
    askingAbout: 'Asking about:',
    askFieldPlaceholder: 'Ask about a field...',
    chatError: 'Sorry, I could not get a response. Please try again.',
    submitDocument: 'Submit Document',
    returnBeforeExpire: 'You can return to this link anytime before it expires.',
    draftUnsaved: 'Unsaved changes',
    draftSaving: 'Saving…',
    draftAutosaveFailed: 'Autosave failed',
    draftReady: 'Ready',
    draftSavedFallback: 'Saved',
    draftSavedJustNow: 'Saved just now',
    draftSavedSeconds: (seconds) => `Saved ${seconds}s ago`,
    draftSavedMinutes: (minutes) => `Saved ${minutes}m ago`,
    draftSavedAt: (time) => `Saved ${time}`,
    documentIsPreparing: 'Document is still preparing. We will keep trying in the background.',
    documentWillRetry: 'Document is still preparing. We will retry automatically.',
    verificationFailed: 'Verification failed',
    failedLoadSession: 'Failed to load session',
    sessionNotFound: 'Session not found',
    failedSwitchLanguage: 'Could not switch language',
    unableSaveFields: 'Unable to save fields',
    unableSubmit: 'Unable to submit',
    failedSaveDraft: 'Failed to save draft',
    failedSaveSignature: 'Failed to save signature',
    failedClearSignature: 'Failed to clear signature',
  },
  vi: {
    chatWelcome: 'Xin chào! Tôi có thể giúp bạn hiểu từng trường. Nhấn biểu tượng chat cạnh trường để hỏi.',
    loadingTitle: 'Đang tải tài liệu của bạn',
    loadingSubtitle: 'Đang chuẩn bị các trường và hướng dẫn.',
    unableToOpen: 'Không thể mở liên kết này',
    almostReady: 'Sắp xong',
    expected: { number: 'Cần nhập: chỉ số', date: 'Cần nhập: ngày', email: 'Cần nhập: địa chỉ email', tel: 'Cần nhập: số điện thoại', text: 'Cần nhập: văn bản' },
    loadingDocument: 'Đang tải tài liệu…',
    pageLabel: (c, t) => `Trang ${c}/${t}`,
    nextField: 'Trường tiếp theo',
    searchFields: 'Tìm trường…',
    requiredOnly: 'Chỉ bắt buộc',
    nextRequired: 'Trường bắt buộc tiếp theo',
    stillPreparingRetry: 'Tài liệu vẫn đang được chuẩn bị. Bạn có thể thử lại ngay.',
    autoRetryPreparing: 'Tài liệu đang được chuẩn bị. Hệ thống sẽ tự thử lại.',
    attemptLabel: 'Lần thử',
    nextRetryIn: (seconds) => `thử lại sau ${seconds} giây`,
    retryNow: 'Thử lại ngay',
    refresh: 'Làm mới',
    documentSubmitted: 'Đã gửi tài liệu',
    documentSubmittedBody: 'Tài liệu của bạn đã được gửi thành công. Bạn có thể đóng trang này.',
    fillDocument: 'Điền tài liệu',
    secureAccess: 'Truy cập bảo mật',
    verifyAccess: 'Xác minh quyền truy cập',
    verifyPromptWithLastName: 'Nhập email và họ của người nhận liên kết này.',
    verifyPromptNoLastName: 'Nhập email của người nhận liên kết này.',
    changeLanguage: 'Đổi ngôn ngữ',
    sentTo: 'Đã gửi tới',
    emailAddress: 'Địa chỉ email',
    lastName: 'Họ',
    intendedRecipientConfirm: 'Tôi xác nhận tôi là người nhận phù hợp và có quyền truy cập tài liệu này.',
    needHelp: 'Cần hỗ trợ?',
    continue: 'Tiếp tục',
    document: 'Tài liệu',
    requiredProgress: (filled, total) => `Hoàn thành ${filled}/${total} trường bắt buộc`,
    saveDraft: 'Lưu nháp',
    submitting: 'Đang gửi...',
    submit: 'Gửi',
    missingFields: 'Trường còn thiếu:',
    documentUnavailable: 'Không thể tải tài liệu',
    documentUnavailableBody: 'Không thể truy cập tài liệu này. Vui lòng thử lại.',
    retryLoading: 'Tải lại',
    unableToLoadDocument: 'Không thể tải tài liệu',
    fieldsTab: 'Trường',
    chatTab: 'Chat',
    completedCount: (filled, total) => `Đã hoàn thành ${filled}/${total}`,
    remainingCount: (remaining) => `Còn lại ${remaining}`,
    checklistTitle: 'Danh sách sẵn sàng gửi',
    checklistDone: 'Hoàn tất',
    checklistLeft: (count) => `Còn ${count}`,
    required: 'Bắt buộc',
    signatures: 'Chữ ký',
    showOnlyIncomplete: 'Chỉ hiện trường chưa hoàn tất',
    unmappedFields: (count) => `${count} trường${count > 1 ? '' : ''} chưa được map trên PDF xem trước.`,
    unmappedHint: 'Bạn vẫn có thể điền và gửi các trường này.',
    noIncompleteFields: 'Không còn trường chưa hoàn tất',
    noFieldsDetected: 'Không phát hiện trường',
    allFieldsComplete: 'Tất cả trường đã hoàn tất.',
    noFormFields: 'Tài liệu này có thể không có trường điền.',
    needsAttention: 'Cần chú ý',
    fieldLabel: 'Trường',
    statusDone: 'Xong',
    statusRequired: 'Bắt buộc',
    statusEmpty: 'Trống',
    signatureStatus: 'Trạng thái chữ ký:',
    signatureCaptured: 'đã ký',
    signatureNotStarted: 'chưa bắt đầu',
    replaceSignature: 'Thay chữ ký',
    saved: 'Đã lưu',
    askAssistant: 'Hỏi Cô',
    completedSection: 'Đã hoàn tất',
    signatureCapturedShort: 'Đã lưu chữ ký.',
    valueLabel: (value) => `Giá trị: ${value}`,
    checked: 'Đã chọn',
    unchecked: 'Chưa chọn',
    savedFallback: 'Đã lưu',
    askingAbout: 'Đang hỏi về:',
    askFieldPlaceholder: 'Hỏi về một trường...',
    chatError: 'Xin lỗi, tôi chưa thể trả lời. Vui lòng thử lại.',
    submitDocument: 'Gửi tài liệu',
    returnBeforeExpire: 'Bạn có thể quay lại liên kết này bất cứ lúc nào trước khi hết hạn.',
    draftUnsaved: 'Có thay đổi chưa lưu',
    draftSaving: 'Đang lưu…',
    draftAutosaveFailed: 'Tự động lưu thất bại',
    draftReady: 'Sẵn sàng',
    draftSavedFallback: 'Đã lưu',
    draftSavedJustNow: 'Vừa lưu xong',
    draftSavedSeconds: (seconds) => `Đã lưu ${seconds} giây trước`,
    draftSavedMinutes: (minutes) => `Đã lưu ${minutes} phút trước`,
    draftSavedAt: (time) => `Đã lưu lúc ${time}`,
    documentIsPreparing: 'Tài liệu đang được chuẩn bị. Hệ thống sẽ tiếp tục thử trong nền.',
    documentWillRetry: 'Tài liệu đang được chuẩn bị. Hệ thống sẽ tự thử lại.',
    verificationFailed: 'Xác minh thất bại',
    failedLoadSession: 'Tải phiên làm việc thất bại',
    sessionNotFound: 'Không tìm thấy phiên',
    failedSwitchLanguage: 'Không thể đổi ngôn ngữ',
    unableSaveFields: 'Không thể lưu trường',
    unableSubmit: 'Không thể gửi',
    failedSaveDraft: 'Không thể lưu nháp',
    failedSaveSignature: 'Không thể lưu chữ ký',
    failedClearSignature: 'Không thể xóa chữ ký',
  },
  es: {
    chatWelcome: 'Hola, puedo ayudarte a entender cada campo. Haz clic en el ícono de chat junto a un campo para preguntar.',
    loadingTitle: 'Cargando tu documento',
    loadingSubtitle: 'Preparando campos y ayuda.',
    unableToOpen: 'No se puede abrir este enlace',
    almostReady: 'Casi listo',
    expected: { number: 'Se espera: solo números', date: 'Se espera: fecha', email: 'Se espera: correo electrónico', tel: 'Se espera: número de teléfono', text: 'Se espera: texto' },
    loadingDocument: 'Cargando documento…',
    pageLabel: (c, t) => `Página ${c} de ${t}`,
    nextField: 'Siguiente campo',
    searchFields: 'Buscar campos…',
    requiredOnly: 'Solo obligatorios',
    nextRequired: 'Siguiente campo obligatorio',
    stillPreparingRetry: 'El documento todavía se está preparando. Puedes reintentar ahora.',
    autoRetryPreparing: 'Tu documento se está preparando. Reintentaremos automáticamente.',
    attemptLabel: 'Intento',
    nextRetryIn: (seconds) => `siguiente intento en ${seconds}s`,
    retryNow: 'Reintentar',
    refresh: 'Actualizar',
    documentSubmitted: 'Documento enviado',
    documentSubmittedBody: 'Tu documento se envió correctamente. Puedes cerrar esta página.',
    fillDocument: 'Completar documento',
    secureAccess: 'Acceso seguro',
    verifyAccess: 'Verifica tu acceso',
    verifyPromptWithLastName: 'Ingresa el correo y apellido al que se envió este enlace.',
    verifyPromptNoLastName: 'Ingresa el correo al que se envió este enlace.',
    changeLanguage: 'Cambiar idioma',
    sentTo: 'Enviado a',
    emailAddress: 'Correo electrónico',
    lastName: 'Apellido',
    intendedRecipientConfirm: 'Confirmo que soy el destinatario previsto y puedo acceder a este documento.',
    needHelp: '¿Necesitas ayuda?',
    continue: 'Continuar',
    document: 'Documento',
    requiredProgress: (filled, total) => `${filled} de ${total} campos obligatorios completados`,
    saveDraft: 'Guardar borrador',
    submitting: 'Enviando...',
    submit: 'Enviar',
    missingFields: 'Campos faltantes:',
    documentUnavailable: 'Documento no disponible',
    documentUnavailableBody: 'No pudimos acceder a este documento. Inténtalo de nuevo.',
    retryLoading: 'Reintentar carga',
    unableToLoadDocument: 'No se pudo cargar el documento',
    fieldsTab: 'Campos',
    chatTab: 'Chat',
    completedCount: (filled, total) => `${filled} de ${total} completados`,
    remainingCount: (remaining) => `${remaining} restantes`,
    checklistTitle: 'Lista para enviar',
    checklistDone: 'Completo',
    checklistLeft: (count) => `${count} pendientes`,
    required: 'Obligatorios',
    signatures: 'Firmas',
    showOnlyIncomplete: 'Mostrar solo incompletos',
    unmappedFields: (count) => `${count} campo${count > 1 ? 's están' : ' está'} sin mapear en la vista previa PDF.`,
    unmappedHint: 'Aun así puedes completar y enviar estos campos.',
    noIncompleteFields: 'No hay campos incompletos',
    noFieldsDetected: 'No se detectaron campos',
    allFieldsComplete: 'Todos los campos están completos.',
    noFormFields: 'Es posible que este documento no tenga campos.',
    needsAttention: 'Necesita atención',
    fieldLabel: 'Campo',
    statusDone: 'Listo',
    statusRequired: 'Requerido',
    statusEmpty: 'Vacío',
    signatureStatus: 'Estado de firma:',
    signatureCaptured: 'capturada',
    signatureNotStarted: 'sin iniciar',
    replaceSignature: 'Reemplazar firma',
    saved: 'Guardado',
    askAssistant: 'Preguntar a Cô',
    completedSection: 'Completado',
    signatureCapturedShort: 'Firma capturada.',
    valueLabel: (value) => `Valor: ${value}`,
    checked: 'Marcado',
    unchecked: 'Sin marcar',
    savedFallback: 'Guardado',
    askingAbout: 'Consultando sobre:',
    askFieldPlaceholder: 'Pregunta sobre un campo...',
    chatError: 'Lo siento, no pude responder. Inténtalo de nuevo.',
    submitDocument: 'Enviar documento',
    returnBeforeExpire: 'Puedes volver a este enlace en cualquier momento antes de que expire.',
    draftUnsaved: 'Cambios sin guardar',
    draftSaving: 'Guardando…',
    draftAutosaveFailed: 'Autoguardado falló',
    draftReady: 'Listo',
    draftSavedFallback: 'Guardado',
    draftSavedJustNow: 'Guardado hace un momento',
    draftSavedSeconds: (seconds) => `Guardado hace ${seconds}s`,
    draftSavedMinutes: (minutes) => `Guardado hace ${minutes}m`,
    draftSavedAt: (time) => `Guardado a las ${time}`,
    documentIsPreparing: 'El documento se está preparando. Seguiremos intentando en segundo plano.',
    documentWillRetry: 'El documento se está preparando. Reintentaremos automáticamente.',
    verificationFailed: 'La verificación falló',
    failedLoadSession: 'No se pudo cargar la sesión',
    sessionNotFound: 'Sesión no encontrada',
    failedSwitchLanguage: 'No se pudo cambiar el idioma',
    unableSaveFields: 'No se pudieron guardar los campos',
    unableSubmit: 'No se pudo enviar',
    failedSaveDraft: 'No se pudo guardar el borrador',
    failedSaveSignature: 'No se pudo guardar la firma',
    failedClearSignature: 'No se pudo borrar la firma',
  },
  pt: {
    chatWelcome: 'Olá! Posso ajudar você a entender cada campo. Clique no ícone de chat ao lado de um campo para perguntar.',
    loadingTitle: 'Carregando seu documento',
    loadingSubtitle: 'Preparando os campos e a orientação.',
    unableToOpen: 'Não foi possível abrir este link',
    almostReady: 'Quase pronto',
    expected: { number: 'Esperado: apenas números', date: 'Esperado: data', email: 'Esperado: e-mail', tel: 'Esperado: telefone', text: 'Esperado: texto' },
    loadingDocument: 'Carregando documento…',
    pageLabel: (c, t) => `Página ${c} de ${t}`,
    nextField: 'Próximo campo',
    searchFields: 'Buscar campos…',
    requiredOnly: 'Somente obrigatórios',
    nextRequired: 'Próximo campo obrigatório',
    stillPreparingRetry: 'Ainda preparando. Você pode tentar novamente agora.',
    autoRetryPreparing: 'Seu documento está sendo preparado. Tentaremos novamente automaticamente.',
    attemptLabel: 'Tentativa',
    nextRetryIn: (seconds) => `próxima tentativa em ${seconds}s`,
    retryNow: 'Tentar novamente',
    refresh: 'Atualizar',
    documentSubmitted: 'Documento enviado',
    documentSubmittedBody: 'Seu documento foi enviado com sucesso. Você pode fechar esta página.',
    fillDocument: 'Preencher documento',
    secureAccess: 'Acesso seguro',
    verifyAccess: 'Verifique seu acesso',
    verifyPromptWithLastName: 'Insira o e-mail e o sobrenome para os quais este link foi enviado.',
    verifyPromptNoLastName: 'Insira o e-mail para o qual este link foi enviado.',
    changeLanguage: 'Mudar idioma',
    sentTo: 'Enviado para',
    emailAddress: 'E-mail',
    lastName: 'Sobrenome',
    intendedRecipientConfirm: 'Confirmo que sou o destinatário pretendido e posso acessar este documento.',
    needHelp: 'Precisa de ajuda?',
    continue: 'Continuar',
    document: 'Documento',
    requiredProgress: (filled, total) => `${filled} de ${total} campos obrigatórios concluídos`,
    saveDraft: 'Salvar rascunho',
    submitting: 'Enviando...',
    submit: 'Enviar',
    missingFields: 'Campos faltando:',
    documentUnavailable: 'Documento indisponível',
    documentUnavailableBody: 'Não foi possível acessar este documento. Tente novamente.',
    retryLoading: 'Tentar carregar novamente',
    unableToLoadDocument: 'Não foi possível carregar o documento',
    fieldsTab: 'Campos',
    chatTab: 'Chat',
    completedCount: (filled, total) => `${filled} de ${total} concluídos`,
    remainingCount: (remaining) => `${remaining} restantes`,
    checklistTitle: 'Lista para enviar',
    checklistDone: 'Completo',
    checklistLeft: (count) => `${count} restantes`,
    required: 'Obrigatórios',
    signatures: 'Assinaturas',
    showOnlyIncomplete: 'Mostrar apenas incompletos',
    unmappedFields: (count) => `${count} campo(s) sem posição na pré-visualização do PDF.`,
    unmappedHint: 'Você ainda pode preencher e enviar esses campos.',
    noIncompleteFields: 'Nenhum campo incompleto',
    noFieldsDetected: 'Nenhum campo detectado',
    allFieldsComplete: 'Todos os campos estão completos.',
    noFormFields: 'Este documento pode não conter campos.',
    needsAttention: 'Requer atenção',
    fieldLabel: 'Campo',
    statusDone: 'Pronto',
    statusRequired: 'Obrigatório',
    statusEmpty: 'Vazio',
    signatureStatus: 'Status da assinatura:',
    signatureCaptured: 'capturada',
    signatureNotStarted: 'não iniciada',
    replaceSignature: 'Substituir assinatura',
    saved: 'Salvo',
    askAssistant: 'Perguntar à Cô',
    completedSection: 'Concluído',
    signatureCapturedShort: 'Assinatura capturada.',
    valueLabel: (value) => `Valor: ${value}`,
    checked: 'Marcado',
    unchecked: 'Desmarcado',
    savedFallback: 'Salvo',
    askingAbout: 'Perguntando sobre:',
    askFieldPlaceholder: 'Pergunte sobre um campo...',
    chatError: 'Desculpe, não consegui responder. Tente novamente.',
    submitDocument: 'Enviar documento',
    returnBeforeExpire: 'Você pode voltar a este link a qualquer momento antes de expirar.',
    draftUnsaved: 'Alterações não salvas',
    draftSaving: 'Salvando…',
    draftAutosaveFailed: 'Falha no salvamento automático',
    draftReady: 'Pronto',
    draftSavedFallback: 'Salvo',
    draftSavedJustNow: 'Salvo agora mesmo',
    draftSavedSeconds: (seconds) => `Salvo há ${seconds}s`,
    draftSavedMinutes: (minutes) => `Salvo há ${minutes}m`,
    draftSavedAt: (time) => `Salvo às ${time}`,
    documentIsPreparing: 'O documento ainda está sendo preparado. Continuaremos tentando em segundo plano.',
    documentWillRetry: 'O documento ainda está sendo preparado. Tentaremos novamente automaticamente.',
    verificationFailed: 'A verificação falhou',
    failedLoadSession: 'Falha ao carregar a sessão',
    sessionNotFound: 'Sessão não encontrada',
    failedSwitchLanguage: 'Não foi possível mudar o idioma',
    unableSaveFields: 'Não foi possível salvar os campos',
    unableSubmit: 'Não foi possível enviar',
    failedSaveDraft: 'Falha ao salvar o rascunho',
    failedSaveSignature: 'Falha ao salvar a assinatura',
    failedClearSignature: 'Falha ao limpar a assinatura',
  },
  fr: {
    chatWelcome: 'Bonjour ! Je peux vous aider à comprendre chaque champ. Cliquez sur l’icône de chat à côté d’un champ pour me poser une question.',
    loadingTitle: 'Chargement de votre document',
    loadingSubtitle: 'Préparation des champs et des conseils.',
    unableToOpen: 'Impossible d’ouvrir ce lien',
    almostReady: 'Presque prêt',
    expected: { number: 'Attendu : chiffres uniquement', date: 'Attendu : date', email: 'Attendu : adresse e-mail', tel: 'Attendu : numéro de téléphone', text: 'Attendu : texte' },
    loadingDocument: 'Chargement du document…',
    pageLabel: (c, t) => `Page ${c} sur ${t}`,
    nextField: 'Champ suivant',
    searchFields: 'Rechercher des champs…',
    requiredOnly: 'Obligatoires seulement',
    nextRequired: 'Champ obligatoire suivant',
    stillPreparingRetry: 'Préparation en cours. Vous pouvez réessayer maintenant.',
    autoRetryPreparing: 'Votre document est en préparation. Nous réessaierons automatiquement.',
    attemptLabel: 'Tentative',
    nextRetryIn: (seconds) => `nouvelle tentative dans ${seconds}s`,
    retryNow: 'Réessayer',
    refresh: 'Actualiser',
    documentSubmitted: 'Document envoyé',
    documentSubmittedBody: 'Votre document a été envoyé avec succès. Vous pouvez fermer cette page.',
    fillDocument: 'Remplir le document',
    secureAccess: 'Accès sécurisé',
    verifyAccess: 'Vérifiez votre accès',
    verifyPromptWithLastName: 'Saisissez l’e-mail et le nom de famille auxquels ce lien a été envoyé.',
    verifyPromptNoLastName: 'Saisissez l’e-mail auquel ce lien a été envoyé.',
    changeLanguage: 'Changer de langue',
    sentTo: 'Envoyé à',
    emailAddress: 'Adresse e-mail',
    lastName: 'Nom de famille',
    intendedRecipientConfirm: 'Je confirme être le destinataire prévu et pouvoir accéder à ce document.',
    needHelp: 'Besoin d’aide ?',
    continue: 'Continuer',
    document: 'Document',
    requiredProgress: (filled, total) => `${filled} sur ${total} champs obligatoires remplis`,
    saveDraft: 'Enregistrer le brouillon',
    submitting: 'Envoi...',
    submit: 'Envoyer',
    missingFields: 'Champs manquants :',
    documentUnavailable: 'Document indisponible',
    documentUnavailableBody: 'Nous n’avons pas pu accéder à ce document. Veuillez réessayer.',
    retryLoading: 'Réessayer le chargement',
    unableToLoadDocument: 'Impossible de charger le document',
    fieldsTab: 'Champs',
    chatTab: 'Chat',
    completedCount: (filled, total) => `${filled} sur ${total} remplis`,
    remainingCount: (remaining) => `${remaining} restants`,
    checklistTitle: 'Prêt à envoyer',
    checklistDone: 'Terminé',
    checklistLeft: (count) => `${count} restants`,
    required: 'Obligatoires',
    signatures: 'Signatures',
    showOnlyIncomplete: 'Afficher seulement les incomplets',
    unmappedFields: (count) => `${count} champ(s) sans position sur l’aperçu PDF.`,
    unmappedHint: 'Vous pouvez quand même remplir et envoyer ces champs.',
    noIncompleteFields: 'Aucun champ incomplet',
    noFieldsDetected: 'Aucun champ détecté',
    allFieldsComplete: 'Tous les champs sont remplis.',
    noFormFields: 'Ce document ne contient peut-être pas de champs.',
    needsAttention: 'À vérifier',
    fieldLabel: 'Champ',
    statusDone: 'Terminé',
    statusRequired: 'Obligatoire',
    statusEmpty: 'Vide',
    signatureStatus: 'État de la signature :',
    signatureCaptured: 'capturée',
    signatureNotStarted: 'non commencée',
    replaceSignature: 'Remplacer la signature',
    saved: 'Enregistré',
    askAssistant: 'Demander à Cô',
    completedSection: 'Terminé',
    signatureCapturedShort: 'Signature capturée.',
    valueLabel: (value) => `Valeur : ${value}`,
    checked: 'Coché',
    unchecked: 'Décoché',
    savedFallback: 'Enregistré',
    askingAbout: 'À propos de :',
    askFieldPlaceholder: 'Posez une question sur un champ...',
    chatError: 'Désolé, je n’ai pas pu répondre. Veuillez réessayer.',
    submitDocument: 'Envoyer le document',
    returnBeforeExpire: 'Vous pouvez revenir à ce lien à tout moment avant son expiration.',
    draftUnsaved: 'Modifications non enregistrées',
    draftSaving: 'Enregistrement…',
    draftAutosaveFailed: 'Échec de l’enregistrement automatique',
    draftReady: 'Prêt',
    draftSavedFallback: 'Enregistré',
    draftSavedJustNow: 'Enregistré à l’instant',
    draftSavedSeconds: (seconds) => `Enregistré il y a ${seconds}s`,
    draftSavedMinutes: (minutes) => `Enregistré il y a ${minutes}m`,
    draftSavedAt: (time) => `Enregistré à ${time}`,
    documentIsPreparing: 'Le document est en cours de préparation. Nous continuerons d’essayer en arrière-plan.',
    documentWillRetry: 'Le document est en cours de préparation. Nous réessaierons automatiquement.',
    verificationFailed: 'La vérification a échoué',
    failedLoadSession: 'Échec du chargement de la session',
    sessionNotFound: 'Session introuvable',
    failedSwitchLanguage: 'Impossible de changer de langue',
    unableSaveFields: 'Impossible d’enregistrer les champs',
    unableSubmit: 'Impossible d’envoyer',
    failedSaveDraft: 'Échec de l’enregistrement du brouillon',
    failedSaveSignature: 'Échec de l’enregistrement de la signature',
    failedClearSignature: 'Échec de l’effacement de la signature',
  },
  zh: {
    chatWelcome: '你好！我可以帮你理解每个字段。点击任意字段旁边的聊天图标即可向我提问。',
    loadingTitle: '正在加载你的文档',
    loadingSubtitle: '正在准备字段和指引。',
    unableToOpen: '无法打开此链接',
    almostReady: '即将就绪',
    expected: { number: '应填：仅数字', date: '应填：日期', email: '应填：电子邮件', tel: '应填：电话号码', text: '应填：文本' },
    loadingDocument: '正在加载文档…',
    pageLabel: (c, t) => `第 ${c} 页，共 ${t} 页`,
    nextField: '下一个字段',
    searchFields: '搜索字段…',
    requiredOnly: '仅必填',
    nextRequired: '下一个必填字段',
    stillPreparingRetry: '仍在准备中。你可以现在重试。',
    autoRetryPreparing: '你的文档正在准备中。我们会自动重试。',
    attemptLabel: '尝试',
    nextRetryIn: (seconds) => `${seconds} 秒后重试`,
    retryNow: '立即重试',
    refresh: '刷新',
    documentSubmitted: '文档已提交',
    documentSubmittedBody: '你的文档已成功提交。你可以关闭此页面。',
    fillDocument: '填写文档',
    secureAccess: '安全访问',
    verifyAccess: '验证你的访问权限',
    verifyPromptWithLastName: '请输入此链接发送到的电子邮件和姓氏。',
    verifyPromptNoLastName: '请输入此链接发送到的电子邮件。',
    changeLanguage: '更改语言',
    sentTo: '发送至',
    emailAddress: '电子邮件',
    lastName: '姓氏',
    intendedRecipientConfirm: '我确认我是预期的收件人，并且可以访问此文档。',
    needHelp: '需要帮助？',
    continue: '继续',
    document: '文档',
    requiredProgress: (filled, total) => `已完成 ${total} 个必填字段中的 ${filled} 个`,
    saveDraft: '保存草稿',
    submitting: '正在提交...',
    submit: '提交',
    missingFields: '缺少的字段：',
    documentUnavailable: '文档不可用',
    documentUnavailableBody: '我们无法访问此文档。请重试。',
    retryLoading: '重试加载',
    unableToLoadDocument: '无法加载文档',
    fieldsTab: '字段',
    chatTab: '聊天',
    completedCount: (filled, total) => `已完成 ${total} 个中的 ${filled} 个`,
    remainingCount: (remaining) => `剩余 ${remaining} 个`,
    checklistTitle: '提交前检查清单',
    checklistDone: '完成',
    checklistLeft: (count) => `还剩 ${count} 个`,
    required: '必填',
    signatures: '签名',
    showOnlyIncomplete: '仅显示未完成',
    unmappedFields: (count) => `有 ${count} 个字段未在 PDF 预览中定位。`,
    unmappedHint: '你仍然可以填写并提交这些字段。',
    noIncompleteFields: '没有未完成的字段',
    noFieldsDetected: '未检测到字段',
    allFieldsComplete: '所有字段均已完成。',
    noFormFields: '此文档可能不包含表格字段。',
    needsAttention: '需要注意',
    fieldLabel: '字段',
    statusDone: '完成',
    statusRequired: '必填',
    statusEmpty: '空',
    signatureStatus: '签名状态：',
    signatureCaptured: '已捕获',
    signatureNotStarted: '未开始',
    replaceSignature: '替换签名',
    saved: '已保存',
    askAssistant: '问 Cô',
    completedSection: '已完成',
    signatureCapturedShort: '签名已捕获。',
    valueLabel: (value) => `值：${value}`,
    checked: '已勾选',
    unchecked: '未勾选',
    savedFallback: '已保存',
    askingAbout: '正在询问：',
    askFieldPlaceholder: '询问某个字段...',
    chatError: '抱歉，我无法回复。请重试。',
    submitDocument: '提交文档',
    returnBeforeExpire: '在链接过期前，你可以随时返回此链接。',
    draftUnsaved: '未保存的更改',
    draftSaving: '正在保存…',
    draftAutosaveFailed: '自动保存失败',
    draftReady: '就绪',
    draftSavedFallback: '已保存',
    draftSavedJustNow: '刚刚保存',
    draftSavedSeconds: (seconds) => `${seconds} 秒前已保存`,
    draftSavedMinutes: (minutes) => `${minutes} 分钟前已保存`,
    draftSavedAt: (time) => `已于 ${time} 保存`,
    documentIsPreparing: '文档仍在准备中。我们会在后台继续尝试。',
    documentWillRetry: '文档仍在准备中。我们会自动重试。',
    verificationFailed: '验证失败',
    failedLoadSession: '无法加载会话',
    sessionNotFound: '未找到会话',
    failedSwitchLanguage: '无法切换语言',
    unableSaveFields: '无法保存字段',
    unableSubmit: '无法提交',
    failedSaveDraft: '无法保存草稿',
    failedSaveSignature: '无法保存签名',
    failedClearSignature: '无法清除签名',
  },
  yue: {
    chatWelcome: '你好！我可以幫你理解每個欄位。撳任何欄位旁邊嘅聊天圖示就可以問我。',
    loadingTitle: '正在載入你嘅文件',
    loadingSubtitle: '正在準備欄位同指引。',
    unableToOpen: '無法開啟呢個連結',
    almostReady: '就快準備好',
    expected: { number: '應填：只限數字', date: '應填：日期', email: '應填：電郵', tel: '應填：電話號碼', text: '應填：文字' },
    loadingDocument: '正在載入文件…',
    pageLabel: (c, t) => `第 ${c} 頁，共 ${t} 頁`,
    nextField: '下一個欄位',
    searchFields: '搜尋欄位…',
    requiredOnly: '只限必填',
    nextRequired: '下一個必填欄位',
    stillPreparingRetry: '仲喺度準備緊。你可以而家重試。',
    autoRetryPreparing: '你嘅文件準備緊。我哋會自動重試。',
    attemptLabel: '嘗試',
    nextRetryIn: (seconds) => `${seconds} 秒後重試`,
    retryNow: '即刻重試',
    refresh: '重新整理',
    documentSubmitted: '文件已提交',
    documentSubmittedBody: '你嘅文件已成功提交。你可以閂咗呢一頁。',
    fillDocument: '填寫文件',
    secureAccess: '安全存取',
    verifyAccess: '驗證你嘅存取權限',
    verifyPromptWithLastName: '請輸入呢個連結寄去嘅電郵同姓氏。',
    verifyPromptNoLastName: '請輸入呢個連結寄去嘅電郵。',
    changeLanguage: '更改語言',
    sentTo: '寄去',
    emailAddress: '電郵',
    lastName: '姓氏',
    intendedRecipientConfirm: '我確認我係指定收件人，並且可以存取呢份文件。',
    needHelp: '需要幫手？',
    continue: '繼續',
    document: '文件',
    requiredProgress: (filled, total) => `已完成 ${total} 個必填欄位中嘅 ${filled} 個`,
    saveDraft: '儲存草稿',
    submitting: '正在提交...',
    submit: '提交',
    missingFields: '缺少嘅欄位：',
    documentUnavailable: '文件無法使用',
    documentUnavailableBody: '我哋無法存取呢份文件。請重試。',
    retryLoading: '重試載入',
    unableToLoadDocument: '無法載入文件',
    fieldsTab: '欄位',
    chatTab: '聊天',
    completedCount: (filled, total) => `已完成 ${total} 個中嘅 ${filled} 個`,
    remainingCount: (remaining) => `仲剩 ${remaining} 個`,
    checklistTitle: '提交前檢查清單',
    checklistDone: '完成',
    checklistLeft: (count) => `仲剩 ${count} 個`,
    required: '必填',
    signatures: '簽名',
    showOnlyIncomplete: '只顯示未完成',
    unmappedFields: (count) => `有 ${count} 個欄位未喺 PDF 預覽度定位。`,
    unmappedHint: '你仍然可以填寫同提交呢啲欄位。',
    noIncompleteFields: '冇未完成嘅欄位',
    noFieldsDetected: '未偵測到欄位',
    allFieldsComplete: '所有欄位都已完成。',
    noFormFields: '呢份文件可能冇表格欄位。',
    needsAttention: '需要注意',
    fieldLabel: '欄位',
    statusDone: '完成',
    statusRequired: '必填',
    statusEmpty: '空',
    signatureStatus: '簽名狀態：',
    signatureCaptured: '已捕捉',
    signatureNotStarted: '未開始',
    replaceSignature: '更換簽名',
    saved: '已儲存',
    askAssistant: '問 Cô',
    completedSection: '已完成',
    signatureCapturedShort: '簽名已捕捉。',
    valueLabel: (value) => `值：${value}`,
    checked: '已剔選',
    unchecked: '未剔選',
    savedFallback: '已儲存',
    askingAbout: '正在詢問：',
    askFieldPlaceholder: '詢問某個欄位...',
    chatError: '對唔住，我無法回覆。請重試。',
    submitDocument: '提交文件',
    returnBeforeExpire: '喺連結過期之前，你可以隨時返嚟呢個連結。',
    draftUnsaved: '未儲存嘅更改',
    draftSaving: '正在儲存…',
    draftAutosaveFailed: '自動儲存失敗',
    draftReady: '就緒',
    draftSavedFallback: '已儲存',
    draftSavedJustNow: '啱啱儲存',
    draftSavedSeconds: (seconds) => `${seconds} 秒前已儲存`,
    draftSavedMinutes: (minutes) => `${minutes} 分鐘前已儲存`,
    draftSavedAt: (time) => `已喺 ${time} 儲存`,
    documentIsPreparing: '文件仲喺度準備緊。我哋會喺背景繼續嘗試。',
    documentWillRetry: '文件仲喺度準備緊。我哋會自動重試。',
    verificationFailed: '驗證失敗',
    failedLoadSession: '無法載入工作階段',
    sessionNotFound: '搵唔到工作階段',
    failedSwitchLanguage: '無法切換語言',
    unableSaveFields: '無法儲存欄位',
    unableSubmit: '無法提交',
    failedSaveDraft: '無法儲存草稿',
    failedSaveSignature: '無法儲存簽名',
    failedClearSignature: '無法清除簽名',
  },
  ht: {
    chatWelcome: 'Bonjou! Mwen ka ede w konprann chak chan. Klike sou ikòn chat la akote yon chan pou poze m yon kesyon.',
    loadingTitle: 'N ap chaje dokiman w lan',
    loadingSubtitle: 'N ap prepare chan yo ak gid la.',
    unableToOpen: 'Pa ka louvri lyen sa a',
    almostReady: 'Prèske pare',
    expected: { number: 'Sa ki atann: chif sèlman', date: 'Sa ki atann: dat', email: 'Sa ki atann: imèl', tel: 'Sa ki atann: nimewo telefòn', text: 'Sa ki atann: tèks' },
    loadingDocument: 'N ap chaje dokiman an…',
    pageLabel: (c, t) => `Paj ${c} sou ${t}`,
    nextField: 'Chan kap vini an',
    searchFields: 'Chèche chan…',
    requiredOnly: 'Obligatwa sèlman',
    nextRequired: 'Chan obligatwa kap vini an',
    stillPreparingRetry: 'N ap prepare toujou. Ou ka eseye ankò kounye a.',
    autoRetryPreparing: 'Dokiman w lan ap prepare. N ap eseye ankò otomatikman.',
    attemptLabel: 'Esè',
    nextRetryIn: (seconds) => `pwochen esè nan ${seconds}s`,
    retryNow: 'Eseye ankò',
    refresh: 'Rafrechi',
    documentSubmitted: 'Dokiman an soumèt',
    documentSubmittedBody: 'Dokiman w lan soumèt avèk siksè. Ou ka fèmen paj sa a.',
    fillDocument: 'Ranpli dokiman an',
    secureAccess: 'Aksè sekirize',
    verifyAccess: 'Verifye aksè w',
    verifyPromptWithLastName: 'Antre imèl ak siyati yo te voye lyen sa a ba li.',
    verifyPromptNoLastName: 'Antre imèl yo te voye lyen sa a ba li.',
    changeLanguage: 'Chanje lang',
    sentTo: 'Voye bay',
    emailAddress: 'Adrès imèl',
    lastName: 'Siyati',
    intendedRecipientConfirm: 'Mwen konfime mwen se moun ki sipoze resevwa l la epi mwen ka aksede dokiman sa a.',
    needHelp: 'Bezwen èd?',
    continue: 'Kontinye',
    document: 'Dokiman',
    requiredProgress: (filled, total) => `${filled} sou ${total} chan obligatwa ranpli`,
    saveDraft: 'Sove bouyon',
    submitting: 'N ap soumèt...',
    submit: 'Soumèt',
    missingFields: 'Chan ki manke:',
    documentUnavailable: 'Dokiman pa disponib',
    documentUnavailableBody: 'Nou pa t ka aksede dokiman sa a. Tanpri eseye ankò.',
    retryLoading: 'Eseye chaje ankò',
    unableToLoadDocument: 'Pa ka chaje dokiman an',
    fieldsTab: 'Chan',
    chatTab: 'Chat',
    completedCount: (filled, total) => `${filled} sou ${total} ranpli`,
    remainingCount: (remaining) => `${remaining} ki rete`,
    checklistTitle: 'Lis pou soumèt',
    checklistDone: 'Konplè',
    checklistLeft: (count) => `${count} ki rete`,
    required: 'Obligatwa',
    signatures: 'Siyati',
    showOnlyIncomplete: 'Montre sèlman sa ki pa konplè',
    unmappedFields: (count) => `${count} chan ki pa gen pozisyon nan apèsi PDF la.`,
    unmappedHint: 'Ou ka toujou ranpli epi soumèt chan sa yo.',
    noIncompleteFields: 'Pa gen chan ki pa konplè',
    noFieldsDetected: 'Pa gen chan detekte',
    allFieldsComplete: 'Tout chan yo konplè.',
    noFormFields: 'Dokiman sa a ka pa gen chan fòm.',
    needsAttention: 'Bezwen atansyon',
    fieldLabel: 'Chan',
    statusDone: 'Fini',
    statusRequired: 'Obligatwa',
    statusEmpty: 'Vid',
    signatureStatus: 'Eta siyati:',
    signatureCaptured: 'kaptire',
    signatureNotStarted: 'poko kòmanse',
    replaceSignature: 'Ranplase siyati',
    saved: 'Sove',
    askAssistant: 'Mande Cô',
    completedSection: 'Konplete',
    signatureCapturedShort: 'Siyati kaptire.',
    valueLabel: (value) => `Valè: ${value}`,
    checked: 'Tcheke',
    unchecked: 'Pa tcheke',
    savedFallback: 'Sove',
    askingAbout: 'Y ap mande sou:',
    askFieldPlaceholder: 'Mande sou yon chan...',
    chatError: 'Padon, mwen pa t ka reponn. Tanpri eseye ankò.',
    submitDocument: 'Soumèt dokiman an',
    returnBeforeExpire: 'Ou ka retounen sou lyen sa a nenpòt lè anvan li ekspire.',
    draftUnsaved: 'Chanjman ki pa sove',
    draftSaving: 'N ap sove…',
    draftAutosaveFailed: 'Otosov echwe',
    draftReady: 'Pare',
    draftSavedFallback: 'Sove',
    draftSavedJustNow: 'Sove kounye a',
    draftSavedSeconds: (seconds) => `Sove ${seconds}s pase`,
    draftSavedMinutes: (minutes) => `Sove ${minutes}m pase`,
    draftSavedAt: (time) => `Sove a ${time}`,
    documentIsPreparing: 'Dokiman an ap prepare toujou. N ap kontinye eseye an background.',
    documentWillRetry: 'Dokiman an ap prepare toujou. N ap eseye ankò otomatikman.',
    verificationFailed: 'Verifikasyon an echwe',
    failedLoadSession: 'Pa ka chaje sesyon an',
    sessionNotFound: 'Sesyon pa jwenn',
    failedSwitchLanguage: 'Pa ka chanje lang',
    unableSaveFields: 'Pa ka sove chan yo',
    unableSubmit: 'Pa ka soumèt',
    failedSaveDraft: 'Pa ka sove bouyon an',
    failedSaveSignature: 'Pa ka sove siyati a',
    failedClearSignature: 'Pa ka efase siyati a',
  },
  ne: {
    chatWelcome: 'नमस्ते! म तपाईंलाई प्रत्येक फिल्ड बुझ्न मद्दत गर्न सक्छु। कुनै पनि फिल्डको छेउमा रहेको च्याट आइकनमा क्लिक गरेर मलाई सोध्नुहोस्।',
    loadingTitle: 'तपाईंको कागजात लोड हुँदैछ',
    loadingSubtitle: 'फिल्ड र मार्गदर्शन तयार हुँदैछ।',
    unableToOpen: 'यो लिङ्क खोल्न सकिएन',
    almostReady: 'लगभग तयार',
    expected: { number: 'अपेक्षित: सङ्ख्या मात्र', date: 'अपेक्षित: मिति', email: 'अपेक्षित: इमेल', tel: 'अपेक्षित: फोन नम्बर', text: 'अपेक्षित: पाठ' },
    loadingDocument: 'कागजात लोड हुँदैछ…',
    pageLabel: (c, t) => `पृष्ठ ${c} / ${t}`,
    nextField: 'अर्को फिल्ड',
    searchFields: 'फिल्ड खोज्नुहोस्…',
    requiredOnly: 'अनिवार्य मात्र',
    nextRequired: 'अर्को अनिवार्य फिल्ड',
    stillPreparingRetry: 'अझै तयार हुँदैछ। तपाईं अहिले पुनः प्रयास गर्न सक्नुहुन्छ।',
    autoRetryPreparing: 'तपाईंको कागजात तयार हुँदैछ। हामी स्वतः पुनः प्रयास गर्नेछौं।',
    attemptLabel: 'प्रयास',
    nextRetryIn: (seconds) => `${seconds}s मा पुनः प्रयास`,
    retryNow: 'अहिले पुनः प्रयास',
    refresh: 'ताजा गर्नुहोस्',
    documentSubmitted: 'कागजात पेश गरियो',
    documentSubmittedBody: 'तपाईंको कागजात सफलतापूर्वक पेश गरियो। तपाईं यो पृष्ठ बन्द गर्न सक्नुहुन्छ।',
    fillDocument: 'कागजात भर्नुहोस्',
    secureAccess: 'सुरक्षित पहुँच',
    verifyAccess: 'तपाईंको पहुँच प्रमाणित गर्नुहोस्',
    verifyPromptWithLastName: 'यो लिङ्क पठाइएको इमेल र थर प्रविष्ट गर्नुहोस्।',
    verifyPromptNoLastName: 'यो लिङ्क पठाइएको इमेल प्रविष्ट गर्नुहोस्।',
    changeLanguage: 'भाषा परिवर्तन गर्नुहोस्',
    sentTo: 'पठाइएको',
    emailAddress: 'इमेल ठेगाना',
    lastName: 'थर',
    intendedRecipientConfirm: 'म पुष्टि गर्छु कि म लक्षित प्रापक हुँ र यो कागजात पहुँच गर्न सक्छु।',
    needHelp: 'मद्दत चाहियो?',
    continue: 'जारी राख्नुहोस्',
    document: 'कागजात',
    requiredProgress: (filled, total) => `${total} मध्ये ${filled} अनिवार्य फिल्ड पूरा भयो`,
    saveDraft: 'मस्यौदा सुरक्षित गर्नुहोस्',
    submitting: 'पेश गर्दै...',
    submit: 'पेश गर्नुहोस्',
    missingFields: 'छुटेका फिल्डहरू:',
    documentUnavailable: 'कागजात उपलब्ध छैन',
    documentUnavailableBody: 'हामी यो कागजात पहुँच गर्न सकेनौं। कृपया पुनः प्रयास गर्नुहोस्।',
    retryLoading: 'लोड पुनः प्रयास गर्नुहोस्',
    unableToLoadDocument: 'कागजात लोड गर्न सकिएन',
    fieldsTab: 'फिल्डहरू',
    chatTab: 'च्याट',
    completedCount: (filled, total) => `${total} मध्ये ${filled} पूरा`,
    remainingCount: (remaining) => `${remaining} बाँकी`,
    checklistTitle: 'पेश गर्न तयार सूची',
    checklistDone: 'पूरा',
    checklistLeft: (count) => `${count} बाँकी`,
    required: 'अनिवार्य',
    signatures: 'हस्ताक्षर',
    showOnlyIncomplete: 'अपूर्ण मात्र देखाउनुहोस्',
    unmappedFields: (count) => `${count} फिल्ड PDF पूर्वावलोकनमा स्थान तोकिएको छैन।`,
    unmappedHint: 'तपाईं अझै पनि यी फिल्डहरू भरेर पेश गर्न सक्नुहुन्छ।',
    noIncompleteFields: 'कुनै अपूर्ण फिल्ड छैन',
    noFieldsDetected: 'कुनै फिल्ड पत्ता लागेन',
    allFieldsComplete: 'सबै फिल्डहरू पूरा भए।',
    noFormFields: 'यो कागजातमा फारम फिल्डहरू नहुन सक्छ।',
    needsAttention: 'ध्यान चाहिन्छ',
    fieldLabel: 'फिल्ड',
    statusDone: 'भयो',
    statusRequired: 'अनिवार्य',
    statusEmpty: 'खाली',
    signatureStatus: 'हस्ताक्षर स्थिति:',
    signatureCaptured: 'खिचियो',
    signatureNotStarted: 'सुरु भएको छैन',
    replaceSignature: 'हस्ताक्षर बदल्नुहोस्',
    saved: 'सुरक्षित',
    askAssistant: 'Cô लाई सोध्नुहोस्',
    completedSection: 'पूरा भयो',
    signatureCapturedShort: 'हस्ताक्षर खिचियो।',
    valueLabel: (value) => `मान: ${value}`,
    checked: 'चिन्ह लगाइयो',
    unchecked: 'चिन्ह लगाइएको छैन',
    savedFallback: 'सुरक्षित',
    askingAbout: 'बारेमा सोध्दै:',
    askFieldPlaceholder: 'कुनै फिल्डबारे सोध्नुहोस्...',
    chatError: 'माफ गर्नुहोस्, म जवाफ दिन सकिनँ। कृपया पुनः प्रयास गर्नुहोस्।',
    submitDocument: 'कागजात पेश गर्नुहोस्',
    returnBeforeExpire: 'लिङ्क समाप्त हुनुअघि तपाईं जुनसुकै बेला यो लिङ्कमा फर्कन सक्नुहुन्छ।',
    draftUnsaved: 'नसुरक्षित परिवर्तनहरू',
    draftSaving: 'सुरक्षित गर्दै…',
    draftAutosaveFailed: 'स्वतः सुरक्षित असफल',
    draftReady: 'तयार',
    draftSavedFallback: 'सुरक्षित',
    draftSavedJustNow: 'भर्खरै सुरक्षित',
    draftSavedSeconds: (seconds) => `${seconds}s अघि सुरक्षित`,
    draftSavedMinutes: (minutes) => `${minutes}m अघि सुरक्षित`,
    draftSavedAt: (time) => `${time} मा सुरक्षित`,
    documentIsPreparing: 'कागजात अझै तयार हुँदैछ। हामी पृष्ठभूमिमा प्रयास गरिरहनेछौं।',
    documentWillRetry: 'कागजात अझै तयार हुँदैछ। हामी स्वतः पुनः प्रयास गर्नेछौं।',
    verificationFailed: 'प्रमाणीकरण असफल',
    failedLoadSession: 'सत्र लोड गर्न सकिएन',
    sessionNotFound: 'सत्र फेला परेन',
    failedSwitchLanguage: 'भाषा बदल्न सकिएन',
    unableSaveFields: 'फिल्डहरू सुरक्षित गर्न सकिएन',
    unableSubmit: 'पेश गर्न सकिएन',
    failedSaveDraft: 'मस्यौदा सुरक्षित गर्न सकिएन',
    failedSaveSignature: 'हस्ताक्षर सुरक्षित गर्न सकिएन',
    failedClearSignature: 'हस्ताक्षर हटाउन सकिएन',
  },
};

const getCsrfToken = () => {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)x-csrf-token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
};

const resolveUiLanguage = (lang) => (SUPPORTED_UI_LANGUAGES.includes(lang) ? lang : 'en');
const getUiCopy = (lang) => UI_COPY[resolveUiLanguage(lang)] || UI_COPY.en;

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

const formatAutosaveLabel = (timestamp, ui) => {
  if (!timestamp) return ui.draftSavedFallback;
  const savedAt = new Date(timestamp);
  if (Number.isNaN(savedAt.getTime())) return ui.draftSavedFallback;
  const diffMs = Date.now() - savedAt.getTime();
  if (diffMs < 10000) return ui.draftSavedJustNow;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return ui.draftSavedSeconds(seconds);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return ui.draftSavedMinutes(minutes);
  return ui.draftSavedAt(savedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
};

export default function FillPage() {
  const router = useRouter();
  const { token, locale } = router.query;
  const routeLocale = typeof locale === 'string' ? locale : 'en';
  const initialUi = getUiCopy(routeLocale);
  const routeUi = getUiCopy(routeLocale);

  const [session, setSession] = useState(null);
  const [fields, setFields] = useState([]);
  const [, setProgress] = useState(null);
  const [fieldValues, setFieldValues] = useState({});
  const [language, setLanguage] = useState(locale || 'en');
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState(null);
  const [uiError, setUiError] = useState(null);
  const [missingFields, setMissingFields] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [verificationNeedsLastName, setVerificationNeedsLastName] = useState(true);
  const [verificationEmail, setVerificationEmail] = useState('');
  const [verificationLastName, setVerificationLastName] = useState('');
  const [verificationToken, setVerificationToken] = useState(null);
  const [maskedEmail, setMaskedEmail] = useState('');
  const [availableLanguages, setAvailableLanguages] = useState(['en']);
  const [reloadKey, setReloadKey] = useState(0);
  const [notReady, setNotReady] = useState(false);
  const [notReadyMessage, setNotReadyMessage] = useState('');
  const [expandedFields, setExpandedFields] = useState(new Set());
  const [fieldSearch, setFieldSearch] = useState('');
  const [requiredOnly, setRequiredOnly] = useState(false);
  const [activeFieldId, setActiveFieldId] = useState(null);
  const [stage, setStage] = useState('verify');
  const [pdfLoadError, setPdfLoadError] = useState('');
  const [pdfReloadKey, setPdfReloadKey] = useState(0);
  const [documentUrl, setDocumentUrl] = useState(null);
  const [documentRetrying, setDocumentRetrying] = useState(false);
  const [activeTab, setActiveTab] = useState('fields');
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', content: initialUi.chatWelcome }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [pendingChatFieldId, setPendingChatFieldId] = useState(null);
  const [currentChatField, setCurrentChatField] = useState('');
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [draftState, setDraftState] = useState('idle');
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [autosaveError, setAutosaveError] = useState('');
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

  const chatEndRef = useRef(null);
  const langMenuRef = useRef(null);
  const latestFieldValuesRef = useRef(fieldValues);
  const submittingRef = useRef(submitting);
  const autosaveTimerRef = useRef(null);
  const autosaveInFlightRef = useRef(false);
  const autosaveQueuedRef = useRef(false);
  const autosaveGenerationRef = useRef(0);
  const handleSubmitRef = useRef(null);
  const inFlightLoadRef = useRef(null);
  const inFlightAbortControllerRef = useRef(null);
  const recoveryActiveRef = useRef(false);
  const verificationTokenRef = useRef(verificationToken);
  const autoDocumentRefreshAttemptedRef = useRef(false);
  const langChangeIdRef = useRef(0);
  const ui = getUiCopy(language || routeLocale);

  useEffect(() => {
    latestFieldValuesRef.current = fieldValues;
  }, [fieldValues]);

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  useEffect(() => {
    recoveryActiveRef.current = recoveryActive;
  }, [recoveryActive]);

  useEffect(() => {
    verificationTokenRef.current = verificationToken;
  }, [verificationToken]);

  useEffect(() => {
    autoDocumentRefreshAttemptedRef.current = false;
  }, [session?.documentUrl]);

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

  // PUT field values to the fill endpoint, splitting into chunks so documents
  // with many fields don't trip the server's per-request field cap
  // (MAX_FIELDS_PER_REQUEST = 200). A real form can exceed that — e.g. a
  // 263-field purchase agreement — which previously made autosave and submit
  // fail with HTTP 400 ("Too many fields"). The server computes cumulative
  // progress across saved values, so the final chunk's response carries the
  // authoritative fillProgress. saveAsDraft applies only to the last chunk.
  const putFieldValuesChunked = useCallback(async (values, saveAsDraft, activeToken, fallbackMessage) => {
    const entries = Object.entries(values || {});
    if (entries.length === 0) return { ok: true, data: { success: true } };
    const CHUNK_SIZE = 150; // safely under the server cap of 200
    let lastResult = { ok: true, data: { success: true } };
    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      const isLast = i + CHUNK_SIZE >= entries.length;
      const slice = Object.fromEntries(entries.slice(i, i + CHUNK_SIZE));
      const res = await fetch(`/api/sessions/${token}/fill`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(activeToken ? { 'x-session-verify': activeToken } : {}),
          'x-csrf-token': getCsrfToken() || '',
        },
        body: JSON.stringify({ fieldValues: slice, saveAsDraft: isLast ? saveAsDraft : true }),
      });
      const result = await parseApiResult(res, fallbackMessage);
      if (!result.ok || !result.data?.success) return result; // bail on first failure
      lastResult = result;
    }
    return lastResult;
  }, [token, parseApiResult]);

  const focusFieldCard = useCallback((fieldId) => {
    if (!fieldId) return;
    setActiveTab('fields');
    setExpandedFields((prev) => new Set([...prev, fieldId]));
    setActiveFieldId(fieldId);
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        const fieldEl = document.getElementById(`field-card-${fieldId}`);
        if (fieldEl) fieldEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }, []);

  // Close language menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target)) {
        setLangMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, []);

  const abortInFlightSessionLoad = useCallback((reason = 'unknown') => {
    inFlightLoadRef.current = null;
    if (!inFlightAbortControllerRef.current) return;
    console.debug('[Fill] Aborting in-flight session load', { reason });
    inFlightAbortControllerRef.current.abort();
    inFlightAbortControllerRef.current = null;
  }, []);

  const loadSessionData = useCallback(async ({
    preserveDraft = false,
    silent = false,
  } = {}) => {
    if (!token) return { state: 'terminal', errorCode: 'invalid_token', message: 'Missing token' };
    if (inFlightLoadRef.current) {
      console.debug('[Fill] Session load skipped (already in flight)');
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
        let storedToken = null;
        if (typeof window !== 'undefined') {
          try {
            storedToken = sessionStorage.getItem(`cosign_verify_${token}`);
          } catch {}
        }
        const authVerificationToken = storedToken || verificationTokenRef.current || null;
        if (authVerificationToken && authVerificationToken !== verificationTokenRef.current) {
          setVerificationToken(authVerificationToken);
        }
        const sessionUrl = `/api/sessions/${token}`;
        const res = await fetch(sessionUrl, {
          cache: 'no-store',
          signal: abortController.signal,
          headers: {
            ...(authVerificationToken ? { 'x-session-verify': authVerificationToken } : {}),
            'cache-control': 'no-cache',
          },
        });
        const data = await res.json().catch(() => ({}));
        const errorCode = data?.errorCode || data?.error;

        if (!res.ok || !data.success) {
          if (errorCode === 'not_ready') {
            setNotReady(true);
            setNotReadyMessage(data?.message || 'Not ready yet');
            return { state: 'not_ready', errorCode, message: data?.message || routeUi.documentIsPreparing, status: res.status };
          }

          if (res.status === 429 || res.status >= 500) {
            return { state: 'retry', errorCode: errorCode || 'session_load_failed', message: data?.message || routeUi.failedLoadSession, status: res.status };
          }

          if (!silent) {
            setFatalError(data?.message || data?.error || routeUi.sessionNotFound);
          }

          return {
            state: TERMINAL_SESSION_ERROR_CODES.has(errorCode) ? 'terminal' : 'retry',
            errorCode: errorCode || 'session_load_failed',
            message: data?.message || data?.error || routeUi.sessionNotFound,
            status: res.status,
          };
        }

        if (data.requiresVerification) {
          setVerificationRequired(true);
          setVerificationNeedsLastName(Boolean(data.requiresLastName));
          setMaskedEmail(data.maskedEmail || '');
          setNotReady(false);
          setStage('verify');
          return { state: 'ready', requiresVerification: true };
        }

        setNotReady(false);
        setNotReadyMessage('');
        setVerificationRequired(false);
        setSession(data.session);
        setFields(data.fields);
        setProgress(data.fillProgress);

        const langs = data.session.availableLanguages || ['en'];
        setAvailableLanguages(langs);
        const sessionPreferredLanguage = data.session.preferredLanguage || data.session.preferred_language || null;
        const nextLanguage = (sessionPreferredLanguage && langs.includes(sessionPreferredLanguage))
          ? sessionPreferredLanguage
          : (langs.includes(routeLocale) ? routeLocale : (langs[0] || 'en'));
        setLanguage((prev) => {
          if (preserveDraft && prev && langs.includes(prev)) return prev;
          return nextLanguage;
        });

        const existing = {};
        data.fields.forEach((f) => {
          if (f.fieldType === 'signature') {
            if (f.signature) {
              existing[f.id] = f.signature;
            }
            return;
          }
          if (f.currentValue !== null && f.currentValue !== undefined) {
            existing[f.id] = f.currentValue;
          }
        });
        setFieldValues((prev) => (preserveDraft ? { ...existing, ...prev } : existing));

        if (data.session.status === 'completed') setCompleted(true);
        // PRD §2.5: on small/medium documents expand every field card by
        // default so recipients fill top-to-bottom without clicking each open.
        // On large documents (e.g. a 200+ field contract) expanding all cards
        // produces an unusable scroll, so collapse by default and expand only
        // the first card — recipients use the "next field" control / checklist
        // to move through them.
        const allFields = data.fields || [];
        const LARGE_DOC_FIELD_THRESHOLD = 30;
        const firstFieldId = allFields[0]?.id;
        if (firstFieldId && !preserveDraft) {
          if (allFields.length > LARGE_DOC_FIELD_THRESHOLD) {
            setExpandedFields(new Set([firstFieldId]));
          } else {
            setExpandedFields(new Set(allFields.map((f) => f.id)));
          }
          setActiveFieldId(firstFieldId);
        }

        setStage('fill');
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
          setFatalError(routeUi.failedLoadSession);
        }
        return {
          state: 'retry',
          errorCode: 'session_load_failed',
          message: err?.message || routeUi.failedLoadSession,
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
  }, [
    routeLocale,
    routeUi.documentIsPreparing,
    routeUi.failedLoadSession,
    routeUi.sessionNotFound,
    token,
  ]);

  const startNotReadyRecovery = useCallback((reason = 'unknown') => {
    if (recoveryActiveRef.current) {
      console.debug('[Fill Recovery] start suppressed (already active)', { reason });
      return;
    }

    recoveryActiveRef.current = true;
    setNotReady(true);
    startRecovery({
      onTry: async () => {
        const outcome = await loadSessionData({ preserveDraft: true, silent: true });
        if (outcome?.state === 'ready') {
          return { state: 'ready' };
        }
        if (outcome?.state === 'terminal') {
          return { state: 'terminal', message: outcome.message };
        }
        return { state: 'retry', message: outcome?.message || routeUi.autoRetryPreparing };
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
        setFatalError(result?.message || routeUi.unableToOpen);
      },
      onTimeout: () => {
        recoveryActiveRef.current = false;
        console.debug('[Fill Recovery] timeout reached');
        setNotReady(true);
        if (!notReadyMessage) setNotReadyMessage(routeUi.autoRetryPreparing);
      },
    });
  }, [loadSessionData, notReadyMessage, routeUi.autoRetryPreparing, routeUi.unableToOpen, startRecovery]);

  const refreshDocumentUrl = useCallback(async (reason = 'manual') => {
    if (documentRetrying) return;
    setDocumentRetrying(true);
    setPdfLoadError('');
    try {
      // Fetch fresh session data (no longer contains signed URL)
      const outcome = await loadSessionData({ preserveDraft: true, silent: true });
      if (outcome?.state === 'not_ready') {
        startNotReadyRecovery(`document_refresh_${reason}_not_ready`);
        return;
      }
      if (outcome?.state === 'ready') {
        // Fetch fresh signed URL from the dedicated gated endpoint
        let verifyToken = verificationToken || verificationTokenRef.current || null;
        if (!verifyToken && typeof window !== 'undefined') {
          try { verifyToken = sessionStorage.getItem(`cosign_verify_${token}`); } catch {}
        }
        const docRes = await fetch(`/api/sessions/${token}/document-url`, {
          headers: {
            ...(verifyToken ? { 'x-session-verify': verifyToken } : {}),
          },
        });
        const docData = await docRes.json().catch(() => ({}));
        if (docRes.ok && docData.success && docData.documentUrl) {
          setDocumentUrl(docData.documentUrl);
        }
        setPdfReloadKey((k) => k + 1);
        return;
      }
      if (outcome?.state === 'terminal') {
        setFatalError(outcome.message || ui.unableToLoadDocument);
      }
    } catch (err) {
      console.warn('[Fill] Failed to refresh document URL', { reason, message: err?.message });
      setPdfLoadError(err?.message || ui.unableToLoadDocument);
    } finally {
      setDocumentRetrying(false);
    }
  }, [documentRetrying, loadSessionData, startNotReadyRecovery, ui.unableToLoadDocument, token, verificationToken]);

  // ============ SESSION LOAD ============
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const outcome = await loadSessionData();
      if (cancelled) return;
      if (outcome?.state === 'not_ready') {
        startNotReadyRecovery('initial_load_not_ready');
      }
    })();
    return () => {
      cancelled = true;
      abortInFlightSessionLoad('effect_cleanup');
    };
  }, [abortInFlightSessionLoad, loadSessionData, reloadKey, startNotReadyRecovery]);

  useEffect(() => {
    if (stage !== 'fill') return;
    if (loading || notReady || documentRetrying) return;
    if (documentUrl) return;
    if (autoDocumentRefreshAttemptedRef.current) return;

    autoDocumentRefreshAttemptedRef.current = true;
    void refreshDocumentUrl('auto_missing_url');
  }, [stage, loading, notReady, documentRetrying, documentUrl, refreshDocumentUrl]);

  const handleLanguageChange = async (newLang) => {
    if (!token) return;
    setLangMenuOpen(false);
    setUiError(null);

    const previousLanguage = language;
    langChangeIdRef.current += 1;
    const changeId = langChangeIdRef.current;
    let activeVerificationToken = verificationToken || verificationTokenRef.current || null;
    if (!activeVerificationToken && typeof window !== 'undefined') {
      try {
        activeVerificationToken = sessionStorage.getItem(`cosign_verify_${token}`) || null;
      } catch {}
    }

    if (verificationRequired && !activeVerificationToken) {
      setStage('verify');
      setUiError(ui.verificationFailed);
      return;
    }

    try {
      const res = await fetch(`/api/sessions/${token}/language`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(activeVerificationToken ? { 'x-session-verify': activeVerificationToken } : {}),
          'x-csrf-token': getCsrfToken() || '',
        },
        body: JSON.stringify({ language: newLang }),
      });
      if (changeId !== langChangeIdRef.current) return;
      const result = await parseApiResult(res, ui.failedSwitchLanguage);
      if (changeId !== langChangeIdRef.current) return;
      if (!result.ok && result.errorCode === 'not_ready') {
        setUiError(ui.documentIsPreparing);
        startNotReadyRecovery('language_change_not_ready');
        return;
      }
      if (!result.ok && result.errorCode === 'verification_required') {
        setLanguage(previousLanguage);
        setVerificationRequired(true);
        setStage('verify');
        setUiError(result.message || ui.verificationFailed);
        return;
      }
      if (!result.ok) {
        setLanguage(previousLanguage);
        setUiError(result.message || ui.failedSwitchLanguage);
        return;
      }
      setLanguage(newLang);
    } catch {
      if (changeId !== langChangeIdRef.current) return;
      setLanguage(previousLanguage);
      setUiError(ui.failedSwitchLanguage);
    }
  };

  const handleFieldChange = (fieldId, value) => {
    setFieldValues(prev => ({ ...prev, [fieldId]: value }));
    setUiError(null);
    setAutosaveError('');
    setDraftState('dirty');
    setMissingFields((prev) => prev.filter((field) => String(field.id) !== String(fieldId)));
    autosaveGenerationRef.current += 1;
    const generation = autosaveGenerationRef.current;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      if (submittingRef.current) return;
      (async () => {
        if (autosaveInFlightRef.current) {
          autosaveQueuedRef.current = true;
          return;
        }

        const editableFieldValues = getEditableFieldValues();
        if (Object.keys(editableFieldValues).length === 0) {
          setDraftState('saved');
          setLastSavedAt(new Date().toISOString());
          return;
        }

        autosaveInFlightRef.current = true;
        autosaveQueuedRef.current = false;
        setDraftState('saving');

        try {
          const activeToken = verificationTokenRef.current || verificationToken;
          const result = await putFieldValuesChunked(editableFieldValues, true, activeToken, ui.failedSaveDraft);
          if (!result.ok || !result.data?.success) {
            if (result.errorCode === 'not_ready') {
              setUiError(ui.documentIsPreparing);
              startNotReadyRecovery('autosave_not_ready');
              setDraftState('dirty');
              return;
            }

            const message = result.message || ui.draftAutosaveFailed;
            setAutosaveError(message);
            setUiError(message);
            setDraftState('error');
            return;
          }

          if (result.data?.fillProgress) {
            setProgress((prev) => ({ ...prev, ...result.data.fillProgress }));
          }

          setAutosaveError('');
          setLastSavedAt(new Date().toISOString());
          setDraftState(generation === autosaveGenerationRef.current ? 'saved' : 'dirty');
        } catch (err) {
          if (err?.errorCode === 'not_ready') {
            setUiError(ui.documentIsPreparing);
            startNotReadyRecovery('autosave_exception_not_ready');
            setDraftState('dirty');
            return;
          }
          const message = err?.message || ui.draftAutosaveFailed;
          setAutosaveError(message);
          setUiError(message);
          setDraftState('error');
        } finally {
          autosaveInFlightRef.current = false;
          if (autosaveQueuedRef.current && !submittingRef.current) {
            autosaveQueuedRef.current = false;
            if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
            autosaveTimerRef.current = setTimeout(() => {
              autosaveGenerationRef.current += 1;
              const nextGeneration = autosaveGenerationRef.current;
              if (submittingRef.current) return;
              (async () => {
                if (autosaveInFlightRef.current) {
                  autosaveQueuedRef.current = true;
                  return;
                }
                const nextValues = getEditableFieldValues();
                if (Object.keys(nextValues).length === 0) {
                  setDraftState('saved');
                  setLastSavedAt(new Date().toISOString());
                  return;
                }
                autosaveInFlightRef.current = true;
                setDraftState('saving');
                try {
                  const queuedToken = verificationTokenRef.current || verificationToken;
                  const nextResult = await putFieldValuesChunked(nextValues, true, queuedToken, ui.failedSaveDraft);
                  if (!nextResult.ok || !nextResult.data?.success) {
                    if (nextResult.errorCode === 'not_ready') {
                      setUiError(ui.documentIsPreparing);
                      startNotReadyRecovery('queued_autosave_not_ready');
                      setDraftState('dirty');
                      return;
                    }
                    const nextMessage = nextResult.message || ui.draftAutosaveFailed;
                    setAutosaveError(nextMessage);
                    setUiError(nextMessage);
                    setDraftState('error');
                    return;
                  }
                  if (nextResult.data?.fillProgress) {
                    setProgress((prev) => ({ ...prev, ...nextResult.data.fillProgress }));
                  }
                  setAutosaveError('');
                  setLastSavedAt(new Date().toISOString());
                  setDraftState(nextGeneration === autosaveGenerationRef.current ? 'saved' : 'dirty');
                } catch (nextErr) {
                  if (nextErr?.errorCode === 'not_ready') {
                    setUiError(ui.documentIsPreparing);
                    startNotReadyRecovery('queued_autosave_exception_not_ready');
                    setDraftState('dirty');
                    return;
                  }
                  const nextMessage = nextErr?.message || ui.draftAutosaveFailed;
                  setAutosaveError(nextMessage);
                  setUiError(nextMessage);
                  setDraftState('error');
                } finally {
                  autosaveInFlightRef.current = false;
                }
              })();
            }, 120);
          }
        }
      })();
    }, 900);
  };

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    clearAutosaveTimer();
  }, [clearAutosaveTimer]);

  const getCurrentFieldValue = useCallback((field) => {
    if (hasOwn(fieldValues, field.id)) return fieldValues[field.id];
    if (field.fieldType === 'signature') return field.signature || '';
    return field.currentValue ?? '';
  }, [fieldValues]);

  const getDisplayFieldName = useCallback((field) => {
    if (!field) return '';
    return field.translations?.[language] || field.fieldName || `${ui.fieldLabel} ${field.id}`;
  }, [language, ui.fieldLabel]);

  const getEditableFieldValues = useCallback(() => {
    const payload = {};
    const currentFieldValues = latestFieldValuesRef.current || {};
    fields.forEach((field) => {
      if (field.fieldType === 'signature') return;
      if (hasOwn(currentFieldValues, field.id)) {
        payload[field.id] = currentFieldValues[field.id];
      }
    });
    return payload;
  }, [fields]);

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
          headers: {
            'Content-Type': 'application/json',
            ...(verificationToken ? { 'x-session-verify': verificationToken } : {}),
            'x-csrf-token': getCsrfToken() || '',
          },
          body: JSON.stringify({
            fieldId: field.id,
            signatureDataUrl: null,
          }),
        });
        const result = await parseApiResult(res, ui.failedClearSignature);
        if (!result.ok || !result.data?.success) {
          const error = new Error(result.message || ui.failedClearSignature);
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
        headers: {
          'Content-Type': 'application/json',
          ...(verificationToken ? { 'x-session-verify': verificationToken } : {}),
          'x-csrf-token': getCsrfToken() || '',
        },
        body: JSON.stringify({
          fieldId: field.id,
          signatureDataUrl: signatureValue,
        }),
      });
      const result = await parseApiResult(res, ui.failedSaveSignature);
      if (!result.ok || !result.data?.success) {
        const error = new Error(result.message || ui.failedSaveSignature);
        error.errorCode = result.errorCode;
        throw error;
      }
      upsertLocalSignature(field.id, signatureValue);
    }
  }, [
    clearLocalSignatureValue,
    fieldValues,
    fields,
    parseApiResult,
    token,
    ui.failedClearSignature,
    ui.failedSaveSignature,
    upsertLocalSignature,
    verificationToken,
  ]);

  const handleSaveDraft = async () => {
    if (autosaveInFlightRef.current || submittingRef.current) return;
    try {
      clearAutosaveTimer();
      autosaveQueuedRef.current = false;
      setDraftState('saving');
      setAutosaveError('');
      setUiError(null);
      await persistSignatures();
      const editableFieldValues = getEditableFieldValues();
      if (Object.keys(editableFieldValues).length === 0) {
        setDraftState('saved');
        setLastSavedAt(new Date().toISOString());
        return;
      }

      const result = await putFieldValuesChunked(editableFieldValues, true, verificationToken, ui.failedSaveDraft);
      if (!result.ok || !result.data?.success) {
        if (result.errorCode === 'not_ready') {
          setUiError(ui.documentWillRetry);
          startNotReadyRecovery('save_draft_not_ready');
          setDraftState('dirty');
          return;
        }
        setDraftState('error');
        setAutosaveError(result.message || ui.failedSaveDraft);
        throw new Error(result.message || ui.failedSaveDraft);
      }
      setProgress(prev => ({ ...prev, ...result.data.fillProgress }));
      setDraftState('saved');
      setLastSavedAt(new Date().toISOString());
    } catch (err) {
      if (err?.errorCode === 'not_ready') {
        setUiError(ui.documentWillRetry);
        startNotReadyRecovery('save_draft_exception_not_ready');
        setDraftState('dirty');
        return;
      }
      setDraftState('error');
      setAutosaveError(err.message || ui.failedSaveDraft);
      setUiError(err.message || ui.failedSaveDraft);
    }
  };

  const handleSubmit = async () => {
    submittingRef.current = true;
    setSubmitting(true);
    try {
      clearAutosaveTimer();
      autosaveQueuedRef.current = false;
      setUiError(null);
      setAutosaveError('');
      setMissingFields([]);
      await persistSignatures();
      const editableFieldValues = getEditableFieldValues();
      if (Object.keys(editableFieldValues).length > 0) {
        const fillResult = await putFieldValuesChunked(editableFieldValues, false, verificationToken, ui.unableSaveFields);
        if (!fillResult.ok) {
          if (fillResult.errorCode === 'not_ready') {
            setUiError(ui.documentWillRetry);
            startNotReadyRecovery('submit_fill_not_ready');
            return;
          }
          setUiError(fillResult.message || ui.unableSaveFields);
          return;
        }
        if (fillResult.data?.fillProgress) {
          setProgress((prev) => ({ ...prev, ...fillResult.data.fillProgress }));
        }
      }

      const res = await fetch(`/api/sessions/${token}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(verificationToken ? { 'x-session-verify': verificationToken } : {}), 'x-csrf-token': getCsrfToken() || '' },
        body: JSON.stringify({ generatePdf: true }),
      });
      const completeResult = await parseApiResult(res, ui.unableSubmit);
      if (!completeResult.ok || !completeResult.data?.success) {
        if (completeResult.errorCode === 'not_ready') {
          setUiError(ui.documentWillRetry);
          startNotReadyRecovery('submit_complete_not_ready');
          return;
        }
        const missing = completeResult.missingFields || [];
        setUiError(completeResult.message || ui.unableSubmit);
        if (completeResult.errorCode === 'missing_required_fields' && missing.length > 0) {
          setMissingFields(missing);
          focusFieldCard(missing[0]?.id);
        }
        return;
      }
      setCompleted(true);
      setDraftState('saved');
      setLastSavedAt(new Date().toISOString());
    } catch (err) {
      if (err?.errorCode === 'not_ready') {
        setUiError(ui.documentWillRetry);
        startNotReadyRecovery('submit_exception_not_ready');
        return;
      }
      setUiError(err.message);
    }
    finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  };

  handleSubmitRef.current = handleSubmit;

  useEffect(() => {
    const shouldWarn = !submitting && (draftState === 'dirty' || draftState === 'saving');
    if (!shouldWarn) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [draftState, submitting]);

  useEffect(() => {
    const handleShortcut = (event) => {
      if (activeTab !== 'fields' || submitting) return;
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return;
      event.preventDefault();
      handleSubmitRef.current?.();
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [activeTab, submitting]);

  // ============ CHAT ============
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  const sendChatMessage = async (message) => {
    if (!message || chatLoading) return;
    setChatMessages(prev => [...prev, { role: 'user', content: message }].slice(-8));
    setChatLoading(true);
    try {
      // The chat route accepts at most 20 history items of 2,000 characters
      // each (24,000 in total); six trimmed items stay well inside that.
      const history = [...chatMessages, { role: 'user', content: message }]
        .slice(-6)
        .map((item) => ({ role: item.role, content: String(item.content || '').slice(0, 2000) }));
      const response = await fetch(`/api/sessions/${token}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(verificationToken ? { 'x-session-verify': verificationToken } : {}) },
        body: JSON.stringify({
          message,
          messages: history,
          // The server builds the document context itself; it only needs to
          // know which field the signer asked about.
          ...(pendingChatFieldId !== null ? { fieldId: String(pendingChatFieldId) } : {}),
          language,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Chat failed');
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.response }].slice(-8));
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: ui.chatError }].slice(-8));
    } finally { setChatLoading(false); setPendingChatFieldId(null); }
  };

  const handleSendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput.trim();
    setChatInput('');
    await sendChatMessage(msg);
  };

  const handleAskCo = (field) => {
    if (!field) return;
    setActiveTab('chat');
    const translation = getDisplayFieldName(field);
    setCurrentChatField(translation);
    setPendingChatFieldId(field.id ?? null);
  };

  const requiredFields = fields.filter((field) => isFieldRequired(field));
  const filledCount = requiredFields.filter((field) =>
    isFilledValue(field.fieldType, getCurrentFieldValue(field), field.signature)
  ).length;
  const totalCount = requiredFields.length;
  const progressPct = totalCount > 0 ? Math.min((filledCount / totalCount) * 100, 100) : 0;
  const missingFieldIdSet = new Set(missingFields.map((field) => String(field.id)));
  const signatureFields = fields.filter((field) => field.fieldType === 'signature');
  const completedSignatureCount = signatureFields.filter((field) =>
    isFilledValue(field.fieldType, getCurrentFieldValue(field), field.signature)
  ).length;
  const incompleteFields = requiredFields.filter((field) =>
    !isFilledValue(field.fieldType, getCurrentFieldValue(field), field.signature)
  );
  const unmappedFields = fields.filter((field) => {
    if (field.hasPosition === false) return true;
    const position = field.position;
    return !position || position.x == null || position.y == null || position.width == null || position.height == null;
  });
  const saveStatusText = (() => {
    if (draftState === 'dirty') return ui.draftUnsaved;
    if (draftState === 'saving') return ui.draftSaving;
    if (draftState === 'error') return ui.draftAutosaveFailed;
    if (draftState === 'saved' || lastSavedAt) return formatAutosaveLabel(lastSavedAt, ui);
    return ui.draftReady;
  })();

  const toggleField = (fieldId) => {
    setExpandedFields(prev => {
      const next = new Set(prev);
      if (next.has(fieldId)) next.delete(fieldId);
      else next.add(fieldId);
      return next;
    });
    setActiveFieldId(fieldId);
  };

  const getFieldStatus = (field) => {
    const currentValue = getCurrentFieldValue(field);
    const isFilled = isFilledValue(field.fieldType, currentValue, field.signature);
    if (isFilled) return 'done';
    if (activeFieldId === field.id) return 'current';
    return 'empty';
  };

  const getInputTypeForField = (fieldType) => {
    if (fieldType === 'date') return 'date';
    if (fieldType === 'email') return 'email';
    if (fieldType === 'tel') return 'tel';
    if (fieldType === 'number') return 'number';
    return 'text';
  };

  const getFieldConstraintHint = (fieldType) => {
    const e = ui.expected || {};
    if (fieldType === 'number') return e.number || 'Expected: numbers only';
    if (fieldType === 'date') return e.date || 'Expected: date';
    if (fieldType === 'email') return e.email || 'Expected: email address';
    if (fieldType === 'tel') return e.tel || 'Expected: phone number';
    return e.text || 'Expected: text';
  };

  const canContinueVerify = verificationRequired
    ? Boolean(verificationEmail && (!verificationNeedsLastName || verificationLastName) && consentChecked)
    : true;

  const handleVerifyContinue = async () => {
    if (verifying) return;
    if (verificationRequired) {
      setVerifying(true);
      try {
        const res = await fetch(`/api/sessions/${token}/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: verificationEmail,
            ...(verificationNeedsLastName ? { lastName: verificationLastName } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) { setUiError(data.error || ui.verificationFailed); return; }
        setVerificationToken(data.verificationToken);
        if (typeof window !== 'undefined') {
          try {
            sessionStorage.setItem(`cosign_verify_${token}`, data.verificationToken);
          } catch (storageError) {
            console.warn('[Fill] Unable to persist verification token in sessionStorage', storageError);
          }
        }
        setVerificationRequired(false);
        setUiError(null);
        setReloadKey((prev) => prev + 1);
        return;
      } catch (err) { setUiError(ui.verificationFailed); return; }
      finally { setVerifying(false); }
    }
    setStage('fill');
  };

  const currentLang = LANGUAGES.find(l => l.code === language) || LANGUAGES[0];
  const filteredLanguages = LANGUAGES.filter(l => availableLanguages.includes(l.code));

  /* ---------- STATE SCREENS ---------- */
  if (loading) {
    return (
      <div className="min-h-screen bg-slateish-50 flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-white border border-slateish-200 rounded-2xl shadow-md p-10 text-center">
          <div className="w-12 h-12 border-4 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto mb-5" />
          <div className="text-lg font-semibold text-slateish-900">{ui.loadingTitle}</div>
          <div className="text-sm text-slateish-500 mt-2">{ui.loadingSubtitle}</div>
        </div>
      </div>
    );
  }
  if (fatalError) {
    return (
      <div className="min-h-screen bg-slateish-50 flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-white border border-red-100 rounded-2xl shadow-md p-10 text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 text-red-500 flex items-center justify-center mx-auto mb-5 text-2xl font-bold">!</div>
          <div className="text-lg font-semibold text-slateish-900">{ui.unableToOpen}</div>
          <div className="text-sm text-slateish-500 mt-2">{fatalError}</div>
        </div>
      </div>
    );
  }
  if (notReady) {
    const compactNotReady = String(notReadyMessage || '').toLowerCase().includes('not ready yet');
    return (
      <div className="min-h-screen bg-slateish-50 flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-white border border-slateish-200 rounded-2xl shadow-md p-10 text-center">
          <div className="w-12 h-12 border-4 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto mb-5" />
          <div className="text-lg font-semibold text-slateish-900">
            {/* Always use the localized string — the raw server message is
                English and would otherwise leak onto vi/es recipient pages. */}
            {ui.almostReady}
          </div>
          {!compactNotReady && (
            <>
              <div className="text-sm text-slateish-500 mt-2">
                {recoveryTimedOut
                  ? ui.stillPreparingRetry
                  : ui.autoRetryPreparing}
              </div>
              <div className="mt-4 text-xs text-slateish-500">
                {ui.attemptLabel} {Math.max(recoveryAttempt, 1)}
                {recoveryActive && secondsUntilNextRetry !== null
                  ? ` · ${ui.nextRetryIn(secondsUntilNextRetry)}`
                  : ''}
              </div>
              <div className="mt-4 flex items-center justify-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-slateish-300 px-3 py-2 text-xs font-semibold text-slateish-700 hover:bg-slateish-50"
                  onClick={() => {
                    if (recoveryActive) retryRecoveryNow();
                    else startNotReadyRecovery('manual_retry');
                  }}
                >
                  {ui.retryNow}
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700"
                  onClick={() => loadSessionData({ preserveDraft: true })}
                >
                  {ui.refresh}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }
  if (completed) {
    return (
      <div className="min-h-screen bg-slateish-50 flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-white border border-emerald-200 rounded-2xl shadow-md p-10 text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-5">
            <FiCheck className="w-7 h-7" />
          </div>
          <div className="text-lg font-semibold text-slateish-900">{ui.documentSubmitted}</div>
          <div className="text-sm text-slateish-500 mt-2">{ui.documentSubmittedBody}</div>
        </div>
      </div>
    );
  }

  /* ---------- MAIN RENDER ---------- */
  return (
    <>
      <Head>
        <title>{session?.documentName || ui.fillDocument} — Cô Sign</title>
      </Head>

      {/* ===== STEP 1: VERIFY ===== */}
      {stage === 'verify' && (
        <div className="min-h-screen bg-slateish-50 flex items-center justify-center p-8">
          <div className="w-full max-w-lg bg-white border border-slateish-200 rounded-2xl shadow-md p-7">
            <img src="/logo/cosign-logo.png" alt="Cô Sign" className="h-7 mb-4" />
            <span className="inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide bg-brand-50 text-brand-600 border border-brand-100">
              {ui.secureAccess}
            </span>
            <h2 className="mt-3.5 text-xl font-bold text-slateish-900">{ui.verifyAccess}</h2>
            <p className="mt-1.5 text-sm text-slateish-500 leading-relaxed">
              {verificationNeedsLastName ? ui.verifyPromptWithLastName : ui.verifyPromptNoLastName}
            </p>
            {uiError && (
              <div className="mt-3 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
                {uiError}
              </div>
            )}
            {maskedEmail && (
              <div className="mt-3.5 px-3 py-2.5 rounded-xl bg-slateish-50 text-slateish-600 text-xs border border-slateish-200">
                {ui.sentTo}: <strong className="text-slateish-800">{maskedEmail}</strong>
              </div>
            )}

            <form className="mt-4 space-y-3.5" onSubmit={(e) => { e.preventDefault(); if (canContinueVerify && !verifying) handleVerifyContinue(); }}>
              <label className="block">
                <span className="text-xs text-slateish-600 font-semibold">{ui.emailAddress}</span>
                <input
                  type="email"
                  placeholder="name@example.com"
                  value={verificationEmail}
                  onChange={(e) => setVerificationEmail(e.target.value)}
                  className="mt-1.5 w-full px-3 py-2.5 border border-slateish-200 rounded-xl text-sm text-slateish-900 placeholder-slateish-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </label>
              {verificationNeedsLastName && (
                <label className="block">
                  <span className="text-xs text-slateish-600 font-semibold">{ui.lastName}</span>
                  <input
                    type="text"
                    placeholder={ui.lastName}
                    value={verificationLastName}
                    onChange={(e) => setVerificationLastName(e.target.value)}
                    className="mt-1.5 w-full px-3 py-2.5 border border-slateish-200 rounded-xl text-sm text-slateish-900 placeholder-slateish-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  />
                </label>
              )}
              <div className="flex items-start gap-2.5 text-xs text-slateish-600 bg-brand-50 border border-brand-100 px-3 py-2.5 rounded-xl">
                <input type="checkbox" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} className="mt-0.5 h-4 w-4 text-brand-600 border-slateish-300 rounded focus:ring-brand-500" />
                <span>{ui.intendedRecipientConfirm}</span>
              </div>
            </form>

            <div className="flex items-center justify-between mt-5">
              <a
                className="text-xs text-slateish-500 hover:text-slateish-700"
                href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Co Sign Fill Link Help')}`}
              >
                {ui.needHelp}
              </a>
              <button
                onClick={handleVerifyContinue}
                disabled={!canContinueVerify || verifying}
                className="px-5 py-2.5 rounded-full bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:bg-slateish-200 disabled:text-slateish-400 disabled:cursor-not-allowed transition-colors"
              >
                {verifying ? <FiLoader className="w-4 h-4 animate-spin inline" /> : ui.continue}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== STEP 2: FILL ===== */}
      {stage === 'fill' && (
        <div className="h-screen flex flex-col bg-slateish-100 relative">
          {/* Header */}
          <header className="bg-white border-b border-slateish-200 flex-shrink-0 z-30">
            <div className="flex items-center justify-between px-5 h-14">
              <div className="flex items-center gap-3 min-w-0">
                <div className="min-w-0">
                  <p className="font-semibold text-slateish-900 truncate text-sm">
                    {session?.documentName || ui.document}
                  </p>
                  <p className="text-xs text-slateish-500">
                    {ui.requiredProgress(filledCount, totalCount)}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className={`px-2 py-0.5 rounded-full border ${
                      draftState === 'saving'
                        ? 'border-blue-200 bg-blue-50 text-blue-700'
                        : draftState === 'dirty'
                          ? 'border-amber-200 bg-amber-50 text-amber-700'
                          : draftState === 'error'
                            ? 'border-red-200 bg-red-50 text-red-700'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    }`}>
                      {saveStatusText}
                    </span>
                    {autosaveError && draftState === 'error' && (
                      <span className="text-red-600">{autosaveError}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Language toggle */}
                <div className="relative" ref={langMenuRef}>
                  <button
                    onClick={() => setLangMenuOpen(!langMenuOpen)}
                    className="flex items-center gap-1.5 text-sm text-slateish-600 hover:text-slateish-900 px-3 py-2 rounded-full hover:bg-slateish-100 transition-colors border border-slateish-200"
                    aria-label={ui.changeLanguage}
                    aria-haspopup="menu"
                    aria-expanded={langMenuOpen}
                  >
                    <FiGlobe className="w-4 h-4" />
                    <span className="hidden sm:inline">{currentLang.flag} {currentLang.label}</span>
                    <span className="sm:hidden">{currentLang.flag}</span>
                  </button>

                  {langMenuOpen && (
                    <div className="absolute right-0 mt-1 w-44 bg-white rounded-xl shadow-lg border border-slateish-200 py-1 z-50">
                      {filteredLanguages.map((lang) => (
                        <button
                          key={lang.code}
                          onClick={() => handleLanguageChange(lang.code)}
                          className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors ${
                            language === lang.code
                              ? 'bg-brand-50 text-brand-700 font-medium'
                              : 'text-slateish-700 hover:bg-slateish-50'
                          }`}
                        >
                          <span>{lang.flag}</span>
                          <span>{lang.label}</span>
                          {language === lang.code && (
                            <FiCheck className="w-4 h-4 ml-auto text-brand-600" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Save draft */}
                <button
                  onClick={handleSaveDraft}
                  disabled={submitting}
                  className="hidden sm:flex items-center gap-2 text-sm text-slateish-600 hover:text-slateish-900 px-3 py-2 rounded-full hover:bg-slateish-100 transition-colors border border-slateish-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label={ui.saveDraft}
                >
                  <FiDownload className="w-4 h-4" />
                  {ui.saveDraft}
                </button>

                {/* Submit / Export */}
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex items-center gap-2 text-sm font-semibold text-white px-4 py-2 rounded-full bg-brand-600 hover:bg-brand-700 transition-colors disabled:opacity-50"
                  aria-label={ui.submitDocument}
                >
                  {submitting ? (
                    <FiLoader className="w-4 h-4 animate-spin" />
                  ) : (
                    <FiSend className="w-4 h-4" />
                  )}
                  <span className="hidden sm:inline">{submitting ? ui.submitting : ui.submit}</span>
                </button>
              </div>
            </div>
          </header>

          {/* Main content */}
          <div className="flex-1 flex flex-col xl:flex-row overflow-hidden">
            {uiError && (
              <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 w-[min(920px,95vw)] px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm shadow-sm">
                <p className="font-semibold">{uiError}</p>
                {missingFields.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-red-700 mb-1.5">{ui.missingFields}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {missingFields.map((field) => (
                        <button
                          key={field.id}
                          type="button"
                          onClick={() => focusFieldCard(field.id)}
                          className="text-xs px-2 py-1 rounded-full bg-white border border-red-200 text-red-700 hover:bg-red-100 transition-colors"
                        >
                          {(() => {
                            const matchingField = fields.find((f) => String(f.id) === String(field.id));
                            return getDisplayFieldName(matchingField || field);
                          })()}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* LEFT: PDF */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-[38vh]">
              {!documentUrl ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slateish-400 bg-slateish-50">
                  <FiFileText className="w-10 h-10 text-slateish-300 mb-3" />
                  <p className="font-semibold text-slateish-900 text-sm mb-1">{ui.documentUnavailable}</p>
                  <p className="text-xs text-slateish-500 mb-4">{ui.documentUnavailableBody}</p>
                  <button
                    onClick={() => { void refreshDocumentUrl('manual_no_url'); }}
                    className="px-4 py-2 text-sm border border-slateish-200 rounded-full text-slateish-600 hover:bg-slateish-50"
                    disabled={documentRetrying}
                  >
                    {documentRetrying ? ui.loadingTitle : ui.retryLoading}
                  </button>
                </div>
              ) : (
                  pdfLoadError ? (
                    <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
                      <p className="font-semibold text-slateish-900 text-sm mb-1">{ui.unableToLoadDocument}</p>
                      <p className="text-xs text-slateish-500 mb-4">{pdfLoadError}</p>
                      <button
                        onClick={() => { void refreshDocumentUrl('manual_load_error'); }}
                        className="px-4 py-2 text-sm border border-slateish-200 rounded-full text-slateish-600 hover:bg-slateish-50"
                        disabled={documentRetrying}
                      >
                        {documentRetrying ? ui.loadingTitle : ui.retryLoading}
                      </button>
                    </div>
                  ) : <PdfViewer
                    key={pdfReloadKey}
                    fileUrl={documentUrl}
                    fileName={session.documentName || ui.document}
                    fileType={session.fileType || 'pdf'}
                    labels={{ loading: ui.loadingDocument, pageLabel: ui.pageLabel }}
                    fields={fields.map((field) => ({
                      ...field,
                      field_value: getCurrentFieldValue(field),
                      field_type: field.fieldType,
                      field_name: getDisplayFieldName(field),
                    }))}
                    onLoadError={(err) => {
                      const message = err?.message || ui.unableToLoadDocument;
                      setPdfLoadError(message);
                      const normalized = String(message).toLowerCase();
                      const shouldRefreshUrl = normalized.includes('403')
                        || normalized.includes('401')
                        || normalized.includes('404')
                        || normalized.includes('expired')
                        || normalized.includes('fetch');
                      if (shouldRefreshUrl && !documentRetrying && !autoDocumentRefreshAttemptedRef.current) {
                        autoDocumentRefreshAttemptedRef.current = true;
                        void refreshDocumentUrl('auto_load_error');
                      }
                    }}
                  />
              )}
            </div>

            {/* RIGHT: Sidebar */}
            <div className="w-full xl:w-[420px] bg-white border-t xl:border-t-0 xl:border-l border-slateish-200 flex flex-col flex-shrink-0 overflow-hidden max-h-[58vh] xl:max-h-none">
              <div className="px-4 pt-4 pb-3 border-b border-slateish-100">
                <div className="rounded-xl border border-slateish-200 bg-slateish-50 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slateish-700">{ui.checklistTitle}</p>
                    <span className="text-[11px] text-slateish-500">
                      {incompleteFields.length === 0 ? ui.checklistDone : ui.checklistLeft(incompleteFields.length)}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-lg bg-white border border-slateish-200 px-2.5 py-2">
                      <p className="text-slateish-500">{ui.required}</p>
                      <p className="font-semibold text-slateish-800 mt-0.5">{filledCount}/{totalCount}</p>
                    </div>
                    <div className="rounded-lg bg-white border border-slateish-200 px-2.5 py-2">
                      <p className="text-slateish-500">{ui.signatures}</p>
                      <p className="font-semibold text-slateish-800 mt-0.5">{completedSignatureCount}/{signatureFields.length}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-slateish-200 flex-shrink-0">
                <button
                  onClick={() => setActiveTab('fields')}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors border-b-2 ${
                    activeTab === 'fields'
                      ? 'border-brand-600 text-brand-600'
                      : 'border-transparent text-slateish-500 hover:text-slateish-700'
                  }`}
                >
                  <FiList className="w-4 h-4" />
                  {ui.fieldsTab}
                  {totalCount > 0 && (
                    <span className="bg-brand-100 text-brand-700 text-xs px-1.5 py-0.5 rounded-full">
                      {totalCount}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('chat')}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors border-b-2 ${
                    activeTab === 'chat'
                      ? 'border-brand-600 text-brand-600'
                      : 'border-transparent text-slateish-500 hover:text-slateish-700'
                  }`}
                >
                  <FiMessageCircle className="w-4 h-4" />
                  {ui.chatTab}
                </button>
              </div>

              {/* Progress bar */}
              <div className="px-4 pt-4">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-brand-600">{ui.completedCount(filledCount, totalCount)}</span>
                  <span className="text-slateish-400">{ui.remainingCount(Math.max(totalCount - filledCount, 0))}</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-brand-50 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-brand-400 to-brand-500 transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              {/* Fields Tab */}
              {activeTab === 'fields' && (
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {fields.length > 15 && (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={fieldSearch}
                        onChange={(e) => setFieldSearch(e.target.value)}
                        placeholder={ui.searchFields}
                        className="w-full border border-slateish-200 rounded-lg px-3 py-2 text-sm text-slateish-900 placeholder-slateish-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setRequiredOnly((v) => !v)}
                          className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${requiredOnly ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-slateish-200 text-slateish-500 hover:bg-slateish-50'}`}
                        >
                          {ui.requiredOnly}
                        </button>
                        {incompleteFields.length > 0 && (
                          <button
                            type="button"
                            onClick={() => focusFieldCard(incompleteFields[0].id)}
                            className="text-xs font-semibold text-brand-700 hover:text-brand-800 inline-flex items-center gap-1"
                          >
                            {ui.nextRequired} <FiChevronDown className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {unmappedFields.length > 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                      <p className="text-xs font-semibold text-amber-800">
                        {ui.unmappedFields(unmappedFields.length)}
                      </p>
                      <p className="text-[11px] text-amber-700 mt-1">
                        {ui.unmappedHint}
                      </p>
                      <p className="text-[11px] text-amber-700 mt-1 truncate">
                        {unmappedFields.slice(0, 3).map((f) => getDisplayFieldName(f)).join(', ')}
                        {unmappedFields.length > 3 ? '...' : ''}
                      </p>
                    </div>
                  )}

                  {fields.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <FiFileText className="w-10 h-10 text-slateish-300 mb-3" />
                      <h4 className="font-semibold text-slateish-900 text-sm mb-1">{ui.noFieldsDetected}</h4>
                      <p className="text-xs text-slateish-500 max-w-[240px]">{ui.noFormFields}</p>
                    </div>
                  )}

                  {fields.map((field) => {
                    const translation = getDisplayFieldName(field);
                    if (requiredOnly && !isFieldRequired(field)) return null;
                    if (fieldSearch.trim()) {
                      const q = fieldSearch.trim().toLowerCase();
                      const hay = `${translation} ${field.fieldName || ''}`.toLowerCase();
                      if (!hay.includes(q)) return null;
                    }
                    const isExpanded = expandedFields.has(field.id);
                    const currentValue = getCurrentFieldValue(field);
                    const status = getFieldStatus(field);
                    const hasValue = status === 'done';
                    const isMissing = missingFieldIdSet.has(String(field.id));
                    return (
                      <div
                        id={`field-card-${field.id}`}
                        key={field.id}
                        className={`border rounded-xl overflow-hidden hover:border-brand-200 transition-colors ${isMissing ? 'border-red-300 bg-red-50/30' : 'border-slateish-100'}`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleField(field.id)}
                          className="w-full flex items-start justify-between gap-2 p-4 bg-gradient-to-r from-white to-brand-50 text-left"
                        >
                          <div>
                            <span className="text-xs text-slateish-400 font-medium">{ui.fieldLabel}</span>
                            <h4 className="font-semibold text-slateish-900 text-sm">{translation}</h4>
                            {language !== 'en' && field.fieldName && field.fieldName !== translation && (
                              <p className="text-xs text-brand-600 mt-0.5">{field.fieldName}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${hasValue ? 'bg-emerald-100 text-emerald-700' : isMissing ? 'bg-red-100 text-red-700' : 'bg-slateish-100 text-slateish-500'}`}>
                              {hasValue ? ui.statusDone : isMissing ? ui.statusRequired : ui.statusEmpty}
                            </span>
                            {isExpanded ? <FiChevronUp className="w-4 h-4 text-slateish-400" /> : <FiChevronDown className="w-4 h-4 text-slateish-400" />}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="p-4 space-y-3">
                            {field.explanation && (
                              <div className="space-y-1.5">
                                <p className="text-sm text-slateish-500 leading-relaxed">{field.explanation}</p>
                              </div>
                            )}

                            {field.fieldType === 'signature' ? (
                              <div className="flex items-start gap-2">
                                <div className="flex-1">
                                  <p className="text-[11px] text-slateish-500 mb-2">
                                    {ui.signatureStatus}{' '}
                                    <span className="font-semibold text-slateish-700">
                                      {currentValue ? ui.signatureCaptured : ui.signatureNotStarted}
                                    </span>
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
                                      onClick={() => handleFieldChange(field.id, '')}
                                      className="mt-2 text-xs font-semibold text-brand-700 hover:text-brand-800"
                                    >
                                      {ui.replaceSignature}
                                    </button>
                                  )}
                                </div>
                                <button
                                  onClick={() => handleAskCo(field)}
                                  className="h-10 w-10 rounded-lg border border-slateish-200 text-slateish-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                                  title={ui.askAssistant}
                                  aria-label={ui.askAssistant}
                                >
                                  <FiMessageCircle className="w-4 h-4 mx-auto" />
                                </button>
                              </div>
                            ) : field.fieldType === 'checkbox' ? (
                              <div className="flex items-center gap-2">
                                <label className="flex items-center gap-2 cursor-pointer flex-1">
                                  <input
                                    type="checkbox"
                                    checked={currentValue === 'true' || currentValue === true}
                                    onChange={(e) => handleFieldChange(field.id, e.target.checked ? 'true' : 'false')}
                                    className="w-4 h-4 text-brand-600 rounded border-slateish-300 focus:ring-brand-500"
                                  />
                                  <span className="text-sm text-slateish-700">{translation}</span>
                                </label>
                                <button
                                  onClick={() => handleAskCo(field)}
                                  className="h-10 w-10 rounded-lg border border-slateish-200 text-slateish-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                                  title={ui.askAssistant}
                                  aria-label={ui.askAssistant}
                                >
                                  <FiMessageCircle className="w-4 h-4 mx-auto" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-start gap-2">
                                <div className="flex-1">
                                  <input
                                    type={getInputTypeForField(field.fieldType)}
                                    value={currentValue || ''}
                                    onChange={(e) => handleFieldChange(field.id, e.target.value)}
                                    placeholder={translation}
                                    inputMode={field.fieldType === 'number' ? 'decimal' : undefined}
                                    className="w-full border border-slateish-200 rounded-lg px-3 py-2 text-sm text-slateish-900 placeholder-slateish-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                                  />
                                  <p className="text-[11px] text-slateish-500 mt-1.5">{getFieldConstraintHint(field.fieldType)}</p>
                                  {hasValue && (
                                    <p className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium mt-1.5">
                                      <FiCheck className="w-3 h-3" /> {ui.saved}
                                    </p>
                                  )}
                                </div>
                                <button
                                  onClick={() => handleAskCo(field)}
                                  className="h-10 w-10 rounded-lg border border-slateish-200 text-slateish-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                                  title={ui.askAssistant}
                                  aria-label={ui.askAssistant}
                                >
                                  <FiMessageCircle className="w-4 h-4 mx-auto" />
                                </button>
                              </div>
                            )}

                            {fields.length > 30 && (() => {
                              const idx = fields.findIndex((f) => f.id === field.id);
                              const next = fields[idx + 1];
                              if (!next) return null;
                              return (
                                <div className="pt-1 flex justify-end">
                                  <button
                                    type="button"
                                    onClick={() => { setExpandedFields(new Set([next.id])); focusFieldCard(next.id); }}
                                    className="text-xs font-semibold text-brand-700 hover:text-brand-800 inline-flex items-center gap-1"
                                  >
                                    {ui.nextField} <FiChevronDown className="w-3 h-3" />
                                  </button>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Chat Tab */}
              {activeTab === 'chat' && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {currentChatField && (
                    <div className="px-4 pt-4">
                      <div className="text-xs text-slateish-500 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">
                        <span className="text-slateish-800">{ui.askingAbout} <strong>{currentChatField}</strong></span>
                      </div>
                    </div>
                  )}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {chatMessages.map((msg, i) => (
                      <div
                        key={i}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        {msg.role === 'assistant' && (
                          <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0 mr-2 mt-1">
                            <span className="text-xs font-bold text-brand-600">Cô</span>
                          </div>
                        )}
                        <div
                          className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                            msg.role === 'user'
                              ? 'bg-brand-600 text-white rounded-br-sm'
                              : 'bg-slateish-50 text-slateish-800 rounded-bl-sm'
                          }`}
                        >
                          {msg.content}
                        </div>
                      </div>
                    ))}

                    {chatLoading && (
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-brand-600">Cô</span>
                        </div>
                        <div className="bg-slateish-50 rounded-2xl rounded-bl-sm px-4 py-3">
                          <div className="flex gap-1">
                            <span className="w-2 h-2 bg-slateish-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-2 h-2 bg-slateish-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-2 h-2 bg-slateish-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  <div className="border-t border-slateish-100 p-3 flex-shrink-0">
                    <div className="flex items-end gap-2">
                      <textarea
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendChat();
                          }
                        }}
                        placeholder={ui.askFieldPlaceholder}
                        rows={1}
                        className="flex-1 border border-slateish-200 rounded-xl px-3 py-2.5 text-sm text-slateish-900 placeholder-slateish-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
                        style={{ minHeight: '42px', maxHeight: '120px' }}
                      />
                      <button
                        onClick={handleSendChat}
                        disabled={!chatInput.trim() || chatLoading}
                        className="p-2.5 bg-brand-600 text-white rounded-xl hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                      >
                        <FiSend className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Submit footer */}
              {activeTab === 'fields' && totalCount > 0 && (
                <div className="border-t border-slateish-200 p-4 flex-shrink-0 space-y-2.5 sticky bottom-0 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
                  <div className="flex items-center justify-between gap-3 text-[11px]">
                    <span className={`font-medium ${
                      draftState === 'saving'
                        ? 'text-blue-700'
                        : draftState === 'dirty'
                          ? 'text-amber-700'
                          : draftState === 'error'
                            ? 'text-red-700'
                            : 'text-emerald-700'
                    }`}>
                      {saveStatusText}
                    </span>
                    {autosaveError && draftState === 'error' && (
                      <span className="text-red-600 text-right">{autosaveError}</span>
                    )}
                  </div>
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="w-full bg-brand-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-brand-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {submitting ? (
                      <>
                        <FiLoader className="w-4 h-4 animate-spin" />
                        {ui.submitting}
                      </>
                    ) : (
                      ui.submitDocument
                    )}
                  </button>
                  <button
                    onClick={handleSaveDraft}
                    disabled={submitting}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold border border-slateish-200 text-slateish-600 hover:bg-slateish-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {ui.saveDraft}
                  </button>
                  <p className="text-[11px] text-slateish-400 text-center">
                    {ui.returnBeforeExpire}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export async function getServerSideProps({ params, res }) {
  const locale = params?.locale || 'en';
  const safeLocale = SUPPORTED_UI_LANGUAGES.includes(locale) ? locale : 'en';
  res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
  return {
    props: {
      messages: (await import(`../../../locales/${safeLocale}.json`)).default,
    },
  };
}
