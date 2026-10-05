import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import { clearAuth, getActiveGroup } from '../services/auth'
import { translate } from '../services/i18n'

const CATEGORY_OPTIONS = ['Food', 'Travel', 'Hotel', 'Transport', 'Office', 'Other']
const CURRENCY_OPTIONS = [
  { code: 'EUR', label: 'Euro', country: 'eu' },
  { code: 'USD', label: 'US Dollar', country: 'us' },
  { code: 'GBP', label: 'British Pound', country: 'gb' },
  { code: 'TND', label: 'Tunisian Dinar', country: 'tn' },
  { code: 'MAD', label: 'Moroccan Dirham', country: 'ma' },
  { code: 'DZD', label: 'Algerian Dinar', country: 'dz' },
  { code: 'CHF', label: 'Swiss Franc', country: 'ch' },
]

const INITIAL_FORM = {
  amount: '',
  currency: '',
  date: '',
  category: 'Other',
  title: 'Scanned Expense',
  note: '',
}

function ScanReceiptPage() {
  const navigate = useNavigate()
  const activeGroup = getActiveGroup()
  const receiptInputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [isScanning, setIsScanning] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [ocrResult, setOcrResult] = useState(null)
  const [ocrText, setOcrText] = useState('')
  const [receiptUrl, setReceiptUrl] = useState('')
  const [editableFields, setEditableFields] = useState(INITIAL_FORM)
  const [isCurrencyMenuOpen, setIsCurrencyMenuOpen] = useState(false)
  const [noteAttachment, setNoteAttachment] = useState(null)
  const [isNoteAttachmentMenuOpen, setIsNoteAttachmentMenuOpen] = useState(false)
  const noteAttachmentInputRef = useRef(null)
  const t = (copy) => translate(copy)

  const handleFileChange = (event) => {
    setError('')
    setSuccessMessage('')
    setOcrResult(null)
    setOcrText('')
    setReceiptUrl('')
    setEditableFields(INITIAL_FORM)
    setNoteAttachment(null)
    setIsNoteAttachmentMenuOpen(false)
    setFile(event.target.files?.[0] || null)
  }

  const handleOpenReceiptPicker = () => {
    receiptInputRef.current?.click()
  }

  const handleScan = async (event) => {
    event.preventDefault()

    if (!file) {
      setError(t({ en: 'Please choose a receipt image first.', fr: 'Veuillez choisir un recu dabord.', ar: 'اختر صورة وصل أولا.' }))
      return
    }

    setIsScanning(true)
    setError('')
    setSuccessMessage('')
    setOcrResult(null)
    setOcrText('')
    setReceiptUrl('')

    try {
      const response = await api.post('/ocr/scan', createReceiptFormData(file), {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })

      const extractedData = getDisplayFields(response.data)

      setOcrResult(extractedData)
      setOcrText(getOcrText(response.data))
      setReceiptUrl(getReceiptUrl(response.data))
      setEditableFields({
        amount: extractedData.total ? String(extractedData.total) : '',
        currency: getCurrencyDisplayValue(extractedData.currency),
        date: extractedData.date || '',
        category: 'Other',
        title: getSuggestedTitle(file),
        note: '',
      })
      setNoteAttachment(null)
      setIsNoteAttachmentMenuOpen(false)
      setSuccessMessage(t({ en: 'Receipt scanned. Please review the fields before saving.', fr: 'Recu analyse. Verifiez les champs avant denregistrer.', ar: 'تم فحص الوصل. راجع الحقول قبل الحفظ.' }))
    } catch (requestError) {
      if (requestError.response?.status === 401) {
        clearAuth()
        navigate('/login')
        return
      }

      setError(getErrorMessage(requestError))
    } finally {
      setIsScanning(false)
    }
  }

  const handleFieldChange = (event) => {
    const { name, value } = event.target
    setEditableFields((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleCurrencyChange = (event) => {
    const { value } = event.target
    setEditableFields((current) => ({
      ...current,
      currency: value,
    }))
    setIsCurrencyMenuOpen(true)
  }

  const handleCurrencySelect = (option) => {
    setEditableFields((current) => ({
      ...current,
      currency: formatCurrencyOption(option),
    }))
    setIsCurrencyMenuOpen(false)
  }

  const handleNoteAttachmentChange = (event) => {
    setNoteAttachment(event.target.files?.[0] || null)
    setIsNoteAttachmentMenuOpen(false)
  }

  const handleOpenNoteAttachmentPicker = () => {
    noteAttachmentInputRef.current?.click()
  }

  const selectedCurrency = findCurrencyOption(editableFields.currency)
  const filteredCurrencies = getFilteredCurrencies(editableFields.currency).slice(0, 6)
  const isExactCurrencyMatch =
    selectedCurrency &&
    formatCurrencyOption(selectedCurrency).toLowerCase() === String(editableFields.currency || '').trim().toLowerCase()

  const handleSaveExpense = async () => {
    if (!receiptUrl) {
      setError(t({ en: 'Please scan a receipt before saving.', fr: 'Veuillez scanner un recu avant denregistrer.', ar: 'افحص الوصل قبل الحفظ.' }))
      return
    }

    if (!editableFields.amount || !editableFields.date || !editableFields.category || !editableFields.title) {
      setError(t({ en: 'Amount, date, category and title are required before saving.', fr: 'Le montant, la date, la categorie et le titre sont obligatoires.', ar: 'المبلغ والتاريخ والفئة والعنوان مطلوبة قبل الحفظ.' }))
      return
    }

    setIsSaving(true)
    setError('')
    setSuccessMessage('')

    try {
      const formData = new FormData()
      formData.append('title', editableFields.title.trim())
      formData.append('amount', editableFields.amount)
      formData.append('currency', normalizeCurrencyValue(editableFields.currency) || '')
      formData.append('category', editableFields.category)
      formData.append('expense_date', editableFields.date)
      formData.append('receipt_url', receiptUrl)
      formData.append('note', editableFields.note.trim() || '')

      if (noteAttachment) {
        formData.append('note_attachment', noteAttachment)
      }

      const response = await api.post('/expenses', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })

      const suspiciousReason =
        response.data?.suspicious_reason ||
        response.data?.suspicious_reasons?.[0] ||
        ''

      setSuccessMessage(
        response.data?.is_suspicious
          ? t({
              en: `Expense saved and flagged for review. ${suspiciousReason}`.trim(),
              fr: `Depense enregistree et signalee pour revision. ${suspiciousReason}`.trim(),
              ar: `Tam hifz almasaerif watam tawjihha lilmurajaa. ${suspiciousReason}`.trim(),
            })
          : t({
              en: 'Expense saved successfully.',
              fr: 'Depense enregistree avec succes.',
              ar: 'تم حفظ المصروف بنجاح.',
            }),
      )
    } catch (requestError) {
      if (requestError.response?.status === 401) {
        clearAuth()
        navigate('/login')
        return
      }

      setError(getErrorMessage(requestError))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1>{t({ en: 'Scan Receipt', fr: 'Scanner le recu', ar: 'فحص الوصل' })}</h1>
          <p className="subtitle">
            {activeGroup
              ? t({
                  en: `${activeGroup.name}: upload a receipt image, review OCR, then save the corrected expense.`,
                  fr: `${activeGroup.name} : importez un recu, verifiez lOCR puis enregistrez la depense corrigee.`,
                  ar: `${activeGroup.name}: irfae surat wasl, raje OCR, thumma ihfaz almasrouf almusahhah.`,
                })
              : t({
                  en: 'Upload a receipt image, review OCR, then save the corrected expense.',
                  fr: 'Importez un recu, verifiez lOCR puis enregistrez la depense corrigee.',
                  ar: 'ارفع صورة وصل، راجع OCR، ثم احفظ المصروف المصحح.',
                })}
          </p>
        </div>
        <div className="header-actions">
          <Link to="/groups" className="secondary-link-button">
            {t({ en: 'Workspaces', fr: 'Espaces de travail', ar: 'مساحات العمل' })}
          </Link>
          <Link to="/dashboard" className="secondary-link-button">
            {t({ en: 'Back to Dashboard', fr: 'Retour au tableau de bord', ar: 'العودة إلى لوحة التحكم' })}
          </Link>
        </div>
      </div>

      <div className="card">
        <form onSubmit={handleScan} className="form">
          <label>
            {t({ en: 'Receipt Image', fr: 'Image du recu', ar: 'صورة الوصل' })}
            <input
              ref={receiptInputRef}
              type="file"
              accept="image/*,.pdf,application/pdf"
              onChange={handleFileChange}
              required
              className="note-attachment-input-hidden"
            />
            <button
              type="button"
              className="custom-upload-trigger"
              onClick={handleOpenReceiptPicker}
            >
              <span className="custom-upload-button-text">
                {t({
                  en: 'Choose receipt',
                  fr: 'Choisir un recu',
                  ar: 'اختر وصلا',
                })}
              </span>
              <span className="custom-upload-file-name">
                {file
                  ? file.name
                  : t({
                      en: 'No file selected',
                      fr: 'Aucun fichier selectionne',
                      ar: 'لا يوجد ملف مختار',
                    })}
              </span>
            </button>
          </label>

          {error ? <p className="message error">{error}</p> : null}
          {successMessage ? <p className="message success">{successMessage}</p> : null}

          <button type="submit" disabled={isScanning}>
            {isScanning
              ? t({ en: 'Scanning...', fr: 'Analyse...', ar: 'جار الفحص...' })
              : t({ en: 'Scan Receipt', fr: 'Scanner le recu', ar: 'فحص الوصل' })}
          </button>
        </form>
      </div>

      {ocrResult || ocrText ? (
        <div className="card review-card">
          <div className="review-layout">
            <section className="ocr-section">
              <h2>{t({ en: 'OCR Result', fr: 'Resultat OCR', ar: 'Natijat OCR' })}</h2>

              {hasDisplayFields(ocrResult) ? (
                <div className="result-grid">
                  <ResultItem label={t({ en: 'Date', fr: 'Date', ar: 'Tarikh' })} value={formatValue(ocrResult?.date)} />
                  <ResultItem label={t({ en: 'Subtotal', fr: 'Sous-total', ar: 'Almajmou alfarai' })} value={formatValue(ocrResult?.subtotal)} />
                  <ResultItem label={t({ en: 'VAT', fr: 'TVA', ar: 'Dhariba' })} value={formatValue(ocrResult?.vat)} />
                  <ResultItem label={t({ en: 'Total', fr: 'Total', ar: 'Almajmou' })} value={formatValue(ocrResult?.total)} />
                  <ResultItem label={t({ en: 'Currency', fr: 'Devise', ar: 'Alomla' })} value={formatCurrencyResult(ocrResult?.currency)} />
                </div>
              ) : (
                <p className="subtle-text">{t({ en: 'No structured OCR fields were found.', fr: 'Aucun champ OCR structure trouve.', ar: 'Lam yutam alathour ala huqoul OCR munazzama.' })}</p>
              )}

              {receiptUrl ? (
                <a
                  href={buildReceiptUrl(receiptUrl)}
                  target="_blank"
                  rel="noreferrer"
                  className="receipt-link"
                >
                  {t({ en: 'View Uploaded Receipt', fr: 'Voir le recu importe', ar: 'Ard alwasl almarfou' })}
                </a>
              ) : null}

              {ocrText ? (
                <div className="ocr-section">
                  <h3>{t({ en: 'OCR Text', fr: 'Texte OCR', ar: 'Nass OCR' })}</h3>
                  <div className="ocr-text-box">{ocrText}</div>
                </div>
              ) : null}
            </section>

            <section className="ocr-section">
              <div className="section-heading">
                <span className="section-kicker">{t({ en: 'Review', fr: 'Revision', ar: 'Murajaa' })}</span>
                <h2>{t({ en: 'Editable Fields', fr: 'Champs modifiables', ar: 'حقول قابلة للتعديل' })}</h2>
                <p className="subtitle">{t({ en: 'Update any OCR mistakes before saving this expense.', fr: 'Corrigez les erreurs OCR avant denregistrer cette depense.', ar: 'Sahhih akhta OCR qabl hifz hadha almasrouf.' })}</p>
              </div>

              <div className="edit-form-shell">
                <div className="edit-grid">
                  <label className="field-card">
                    <span className="field-label">{t({ en: 'Amount', fr: 'Montant', ar: 'Mablagh' })}</span>
                    <span className="field-help">{t({ en: 'Use the final paid amount from the bill.', fr: 'Utilisez le montant final paye.', ar: 'Istamil almablagh alnihai almadfou.' })}</span>
                    <input
                      type="number"
                      step="0.01"
                      name="amount"
                      value={editableFields.amount}
                      onChange={handleFieldChange}
                      className="field-input"
                    />
                  </label>

                  <div
                    className="field-card currency-field-card"
                    onBlur={() => {
                      window.setTimeout(() => setIsCurrencyMenuOpen(false), 120)
                    }}
                  >
                    <span className="field-label">{t({ en: 'Currency', fr: 'Devise', ar: 'Omla' })}</span>
                    <span className="field-help">{t({ en: 'Start typing a code, country, or currency name.', fr: 'Commencez a taper un code, un pays ou une devise.', ar: 'Ibda biktabat ramz aw balad aw ism alomla.' })}</span>
                    <div className="currency-picker">
                      <span className="currency-side-flag" aria-hidden="true">
                        <FlagBadge country={selectedCurrency?.country} />
                      </span>
                      <input
                        type="text"
                        name="currency"
                        value={editableFields.currency}
                        onChange={handleCurrencyChange}
                        onFocus={() => setIsCurrencyMenuOpen(true)}
                        placeholder={t({ en: 'Type currency name or code', fr: 'Saisissez un nom ou un code de devise', ar: 'Aktub ism alomla aw ramzaha' })}
                        autoComplete="off"
                        spellCheck={false}
                        className="field-input currency-search-input"
                      />

                      {isCurrencyMenuOpen && !isExactCurrencyMatch ? (
                        <div className="currency-option-list">
                          {filteredCurrencies.length ? (
                            filteredCurrencies.map((option) => (
                              <button
                                key={option.code}
                                type="button"
                                className="currency-option"
                                aria-label={formatCurrencyOption(option)}
                                title={formatCurrencyOption(option)}
                                onMouseDown={(event) => {
                                  event.preventDefault()
                                  handleCurrencySelect(option)
                                }}
                              >
                                <span className="currency-option-main">
                                  <FlagBadge country={option.country} className="currency-inline-flag" />
                                </span>
                                <span className="currency-code">{option.code}</span>
                              </button>
                            ))
                          ) : (
                            <div className="currency-option-empty">{t({ en: 'No matching currency found.', fr: 'Aucune devise correspondante.', ar: 'لا توجد عملة مطابقة.' })}</div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <label className="field-card">
                    <span className="field-label">{t({ en: 'Date', fr: 'Date', ar: 'Tarikh' })}</span>
                    <span className="field-help">{t({ en: 'Adjust the invoice or receipt date if needed.', fr: 'Ajustez la date si necessaire.', ar: 'Addil attarikh idha lazim.' })}</span>
                    <input
                      type="date"
                      name="date"
                      value={editableFields.date}
                      onChange={handleFieldChange}
                      className="field-input"
                    />
                  </label>

                  <label className="field-card">
                    <span className="field-label">{t({ en: 'Category', fr: 'Categorie', ar: 'Fia' })}</span>
                    <span className="field-help">{t({ en: 'Choose the best fit for reporting.', fr: 'Choisissez la meilleure categorie.', ar: 'Ikhtar afdal fia littaqrir.' })}</span>
                    <select
                      name="category"
                      value={editableFields.category}
                      onChange={handleFieldChange}
                      className="field-input"
                    >
                      {CATEGORY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {translateCategory(option)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field-card edit-grid-wide">
                    <span className="field-label">{t({ en: 'Title', fr: 'Titre', ar: 'Unwan' })}</span>
                    <span className="field-help">{t({ en: 'Give the expense a clear name for the supervisor.', fr: 'Donnez un titre clair pour le superviseur.', ar: 'Aati almasaerif unwanan wadihan lilmushrif.' })}</span>
                    <input
                      type="text"
                      name="title"
                      value={editableFields.title}
                      onChange={handleFieldChange}
                      className="field-input"
                    />
                  </label>

                  <label className="field-card edit-grid-wide">
                    <span className="field-label">{t({ en: 'Note / Remark', fr: 'Note / Remarque', ar: 'Note / Mulahaza' })}</span>
                    <span className="field-help">
                      {t({
                        en: 'Optional: add any extra detail the reviewer should know.',
                        fr: 'Optionnel : ajoutez tout detail utile pour la revision.',
                        ar: 'Ikhtiyari: add ay tafsil idafi lilmorajaa.',
                      })}
                    </span>
                    <div className="note-input-shell">
                      <textarea
                        name="note"
                        value={editableFields.note}
                        onChange={handleFieldChange}
                        className="field-input field-textarea note-textarea"
                        rows="4"
                      />
                      <input
                        ref={noteAttachmentInputRef}
                        type="file"
                        accept=".jpg,.jpeg,.png,.webp,.pdf,.txt,.doc,.docx"
                        className="note-attachment-input-hidden"
                        onChange={handleNoteAttachmentChange}
                      />
                      <div className="note-actions-stack">
                        {isNoteAttachmentMenuOpen ? (
                          <button
                            type="button"
                            className="note-upload-trigger"
                            onClick={handleOpenNoteAttachmentPicker}
                          >
                            <span className="note-upload-trigger-icon" aria-hidden="true">
                              +
                            </span>
                            <span>
                              {t({
                                en: 'Upload file',
                                fr: 'Ajouter un fichier',
                                ar: 'Irfaq malaf',
                              })}
                            </span>
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="note-plus-button"
                          onClick={() => setIsNoteAttachmentMenuOpen((current) => !current)}
                          aria-label={t({
                            en: 'Add note attachment',
                            fr: 'Ajouter une piece jointe a la note',
                            ar: 'إضافة مرفق للملاحظة',
                          })}
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <span className="note-attachment-name">
                      {noteAttachment
                        ? noteAttachment.name
                        : t({
                            en: 'No file selected',
                            fr: 'Aucun fichier selectionne',
                            ar: 'La yojad malaf mokhtar',
                          })}
                    </span>
                  </label>
                </div>

                <div className="edit-footer">
                  <div className="edit-summary">
                    <span className="edit-summary-label">{t({ en: 'Ready to save', fr: 'Pret a enregistrer', ar: 'Jahiz lilhifz' })}</span>
                    <strong>
                      {editableFields.amount || '0'}
                      {selectedCurrency ? ` ${selectedCurrency.code}` : ''}
                    </strong>
                  </div>

                  <button
                    type="button"
                    className="primary-link-button save-expense-button"
                    onClick={handleSaveExpense}
                    disabled={isSaving}
                  >
                    {isSaving
                      ? t({ en: 'Saving...', fr: 'Enregistrement...', ar: 'Jari alhifz...' })
                      : t({ en: 'Save Expense', fr: 'Enregistrer la depense', ar: 'Ihfaz almasrouf' })}
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ResultItem({ label, value }) {
  return (
    <div className="result-item">
      <span className="result-label">{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function FlagBadge({ country, className = '' }) {
  const safeClassName = ['flag-badge', className].filter(Boolean).join(' ')

  switch (country) {
    case 'eu':
      return (
        <svg viewBox="0 0 28 20" className={safeClassName} aria-hidden="true">
          <rect width="28" height="20" rx="4" fill="#1d4ed8" />
          <circle cx="14" cy="5" r="1" fill="#facc15" />
          <circle cx="18" cy="6" r="1" fill="#facc15" />
          <circle cx="20" cy="10" r="1" fill="#facc15" />
          <circle cx="18" cy="14" r="1" fill="#facc15" />
          <circle cx="14" cy="15" r="1" fill="#facc15" />
          <circle cx="10" cy="14" r="1" fill="#facc15" />
          <circle cx="8" cy="10" r="1" fill="#facc15" />
          <circle cx="10" cy="6" r="1" fill="#facc15" />
        </svg>
      )
    case 'us':
      return (
        <svg viewBox="0 0 28 20" className={safeClassName} aria-hidden="true">
          <rect width="28" height="20" rx="4" fill="#ffffff" />
          <rect width="28" height="3" y="0" fill="#dc2626" />
          <rect width="28" height="3" y="6" fill="#dc2626" />
          <rect width="28" height="3" y="12" fill="#dc2626" />
          <rect width="28" height="3" y="18" fill="#dc2626" />
          <rect width="12" height="11" fill="#1e3a8a" />
        </svg>
      )
    case 'gb':
      return (
        <svg viewBox="0 0 28 20" className={safeClassName} aria-hidden="true">
          <rect width="28" height="20" rx="4" fill="#1e3a8a" />
          <path d="M0 2.5 3 0l25 17.5-3 2.5Z" fill="#fff" />
          <path d="M25 0h3v2.5L3 20H0v-2.5Z" fill="#fff" />
          <path d="M0 4 4 0l24 16v4Z" fill="#dc2626" />
          <path d="M24 0h4v4L4 20H0v-4Z" fill="#dc2626" />
          <rect x="11" width="6" height="20" fill="#fff" />
          <rect y="7" width="28" height="6" fill="#fff" />
          <rect x="12" width="4" height="20" fill="#dc2626" />
          <rect y="8" width="28" height="4" fill="#dc2626" />
        </svg>
      )
    case 'tn':
      return (
        <svg viewBox="0 0 28 20" className={safeClassName} aria-hidden="true">
          <rect width="28" height="20" rx="4" fill="#dc2626" />
          <circle cx="14" cy="10" r="5.5" fill="#fff" />
          <circle cx="15" cy="10" r="3.2" fill="#dc2626" />
          <circle cx="16" cy="10" r="2.5" fill="#fff" />
          <path d="m18.8 10-1.8.5 1.1 1.5-1.9-.7-1.1 1.5v-1.8l-1.8-.5 1.8-.5V8.2l1.1 1.5 1.9-.7-1.1 1.5Z" fill="#dc2626" />
        </svg>
      )
    case 'ma':
      return (
        <svg viewBox="0 0 28 20" className={safeClassName} aria-hidden="true">
          <rect width="28" height="20" rx="4" fill="#dc2626" />
          <path d="m14 5 1.3 3.7h3.9l-3.2 2.3 1.2 3.7-3.2-2.3-3.2 2.3 1.2-3.7-3.2-2.3h3.9Z" fill="none" stroke="#166534" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      )
    case 'dz':
      return (
        <svg viewBox="0 0 28 20" className={safeClassName} aria-hidden="true">
          <rect width="14" height="20" fill="#16a34a" />
          <rect x="14" width="14" height="20" fill="#fff" />
          <circle cx="15" cy="10" r="4.6" fill="#dc2626" />
          <circle cx="16.4" cy="10" r="3.8" fill="#fff" />
          <path d="m18.8 10-1.6.5 1 1.3-1.6-.6-1 1.3v-1.6l-1.6-.5 1.6-.5V8.3l1 1.3 1.6-.6-1 1.3Z" fill="#dc2626" />
        </svg>
      )
    case 'ch':
      return (
        <svg viewBox="0 0 28 20" className={safeClassName} aria-hidden="true">
          <rect width="28" height="20" rx="4" fill="#dc2626" />
          <rect x="11.5" y="4" width="5" height="12" fill="#fff" />
          <rect x="8" y="7.5" width="12" height="5" fill="#fff" />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 28 20" className={safeClassName} aria-hidden="true">
          <rect width="28" height="20" rx="4" fill="#cbd5e1" />
        </svg>
      )
  }
}

function getExtractedData(payload) {
  return (
    payload?.extracted ||
    payload?.extracted_data ||
    payload?.data?.extracted ||
    payload?.data?.extracted_data ||
    payload?.receipt ||
    {}
  )
}

function getDisplayFields(payload) {
  const extractedData = getExtractedData(payload)

  return {
    date: extractedData?.date ?? '',
    subtotal: extractedData?.subtotal ?? '',
    vat: extractedData?.vat ?? '',
    total: extractedData?.total ?? '',
    currency: extractedData?.currency ?? '',
  }
}

function getErrorMessage(requestError) {
  return (
    requestError.response?.data?.error ||
    requestError.response?.data?.message ||
    requestError.message ||
    'Unable to process this receipt.'
  )
}

function getOcrText(payload) {
  return payload?.text || payload?.data?.text || payload?.ocr?.text || payload?.data?.ocr?.text || ''
}

function getReceiptUrl(payload) {
  return payload?.receipt_url || payload?.data?.receipt_url || ''
}

function hasDisplayFields(result) {
  return Boolean(result?.date || result?.subtotal || result?.vat || result?.total || result?.currency)
}

function createReceiptFormData(file) {
  const formData = new FormData()
  formData.append('receipt', file)
  return formData
}

function buildReceiptUrl(receiptUrl) {
  const apiBase = api.defaults.baseURL?.replace(/\/api$/, '') || 'http://localhost:5000'
  return `${apiBase}/uploads/${receiptUrl}`
}

function getSuggestedTitle(file) {
  const baseName = file?.name?.replace(/\.[^.]+$/, '').trim()
  return baseName || 'Scanned Expense'
}

function formatValue(value) {
  return value === undefined || value === null || value === '' ? '-' : String(value)
}

function formatCurrencyResult(currencyCode) {
  if (!currencyCode) {
    return '-'
  }

  const currencyOption = CURRENCY_OPTIONS.find((option) => option.code === currencyCode)
  return currencyOption ? formatCurrencyOption(currencyOption) : String(currencyCode)
}

function getCurrencyDisplayValue(currencyCode) {
  if (!currencyCode) {
    return ''
  }

  const currencyOption = CURRENCY_OPTIONS.find((option) => option.code === currencyCode)
  return currencyOption ? formatCurrencyOption(currencyOption) : String(currencyCode)
}

function formatCurrencyOption(option) {
  return `${option.label} (${option.code})`
}

function findCurrencyOption(value) {
  const normalizedInput = String(value || '').trim().toLowerCase()

  if (!normalizedInput) {
    return null
  }

  return (
    CURRENCY_OPTIONS.find((option) => {
      const displayValue = formatCurrencyOption(option).toLowerCase()
      return (
        option.code.toLowerCase() === normalizedInput ||
        option.label.toLowerCase() === normalizedInput ||
        displayValue === normalizedInput ||
        displayValue.includes(normalizedInput)
      )
    }) || null
  )
}

function getFilteredCurrencies(value) {
  const normalizedInput = String(value || '').trim().toLowerCase()

  if (!normalizedInput) {
    return CURRENCY_OPTIONS
  }

  return CURRENCY_OPTIONS.filter((option) => {
    const searchableValues = [
      option.code,
      option.label,
      formatCurrencyOption(option),
      option.country,
    ]

    return searchableValues.some((searchableValue) =>
      searchableValue.toLowerCase().includes(normalizedInput),
    )
  })
}

function normalizeCurrencyValue(value) {
  const normalizedInput = String(value || '').trim().toLowerCase()

  if (!normalizedInput) {
    return null
  }

  const match = CURRENCY_OPTIONS.find((option) => {
    const labelValue = `${option.label} (${option.code})`.toLowerCase()
    const displayValue = formatCurrencyOption(option).toLowerCase()
    return (
      option.code.toLowerCase() === normalizedInput ||
      option.label.toLowerCase() === normalizedInput ||
      labelValue === normalizedInput ||
      displayValue === normalizedInput
    )
  })

  if (match) {
    return match.code
  }

  const detectedCode = normalizedInput.match(/\(([a-z]{3})\)$/i)?.[1]
  return detectedCode ? detectedCode.toUpperCase() : String(value).trim().toUpperCase()
}

function translateCategory(category) {
  return translate({
    en: category,
    fr:
      {
        Food: 'Repas',
        Travel: 'Voyage',
        Hotel: 'Hotel',
        Transport: 'Transport',
        Office: 'Bureau',
        Other: 'Autre',
      }[category] || category,
    ar:
      {
        Food: 'طعام',
        Travel: 'سفر',
        Hotel: 'فندق',
        Transport: 'نقل',
        Office: 'مكتب',
        Other: 'أخرى',
      }[category] || category,
  })
}

export default ScanReceiptPage
