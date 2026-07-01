/**
 * App.jsx — X12 834 ↔ CSV Converter UI
 *
 * Features:
 *  - Toggle switch to select conversion direction (CSV→EDI or EDI→CSV)
 *  - Drag-and-drop + click-to-browse file zone with file-type validation
 *  - Upload progress via XHR (so we get real progress events)
 *  - Loading spinner during conversion
 *  - Error banners with detail text
 *  - Success flash + automatic browser download of the converted file
 *  - Sample CSV download so users know the expected column layout
 */

import React, { useState, useCallback, useRef } from 'react';

// ── Constants ─────────────────────────────────────────────────────────────────

const DIRECTIONS = {
  CSV_TO_EDI: 'csv-to-edi',
  EDI_TO_CSV: 'edi-to-csv',
};

// Accepted MIME types / extensions per direction
const ACCEPTED = {
  [DIRECTIONS.CSV_TO_EDI]: {
    types: ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
    exts:  ['.csv'],
    label: 'CSV (.csv)',
  },
  [DIRECTIONS.EDI_TO_CSV]: {
    types: ['text/plain', 'application/octet-stream', 'application/EDI-X12'],
    exts:  ['.edi', '.x12', '.txt', '.834'],
    label: 'EDI (.edi, .x12, .txt)',
  },
};

// Minimal sample CSV — headers only so users see all available columns
const SAMPLE_CSV = `subscriber_id,first_name,last_name,middle_name,ssn,dob,gender,relationship_code,maintenance_type_code,maintenance_reason_code,address1,address2,city,state,zip,phone,email,plan_id,coverage_type_code,coverage_level_code,effective_date,termination_date,employer_name,employer_id,payer_name,payer_id,group_number,employment_status,name_prefix,name_suffix,marital_status,race_ethnicity_code,citizenship_status_code,student_status,handicap_indicator,death_date,confidentiality_code,birth_sequence,employment_begin_date,incorrect_last_name,incorrect_first_name,incorrect_dob,incorrect_gender,mail_address1,mail_address2,mail_city,mail_state,mail_zip,emp_org_name,emp_org_id,emp_org_id_qual,emp_org_phone,emp_org_address1,emp_org_city,emp_org_state,emp_org_zip,school_name,custodial_last_name,custodial_first_name,responsible_entity_code,responsible_last_name,responsible_first_name,dropoff_location_name,dropoff_address1,dropoff_city,dropoff_state,dropoff_zip,disability_type_code,disability_begin_date,disability_end_date,late_enrollment_indicator,enrollment_signature_date,maintenance_effective_date,last_premium_paid_date,prior_coverage_months,coverage_amount_qualifier,coverage_amount,id_card_type,provider_entity_code,provider_entity_type,provider_last_name,provider_first_name,provider_id_qual,provider_id,provider_patient_status,cob_payer_responsibility,cob_group_number,cob_code,cob_begin_date,cob_end_date,cob_insurer_name,cob_insurer_id_qual,cob_insurer_id,cob_contact_phone,reporting_category,reporting_category_ref_qual,reporting_category_ref_id,reporting_category_date
EMP001,Jane,Smith,A,123456789,1985-06-15,F,18,021,,100 Main St,,Springfield,IL,62701,2175550100,jane.smith@example.com,PLAN-GOLD,HLT,FAM,2025-01-01,,Acme Corp,ACME001,Blue Cross Blue Shield,BCBS001,GRP-2025,FT
`;

// ── Utility helpers ───────────────────────────────────────────────────────────

/**
 * Validate that a File object is an acceptable type for the chosen direction.
 * Returns null on success, or an error string.
 */
function validateFile(file, direction) {
  const { exts } = ACCEPTED[direction];
  const name = (file.name || '').toLowerCase();
  if (!exts.some(ext => name.endsWith(ext))) {
    return `Invalid file type. Expected ${exts.join(', ')} for this conversion direction.`;
  }
  if (file.size > 50 * 1024 * 1024) {
    return 'File exceeds the 50 MB size limit.';
  }
  return null;
}

/**
 * Trigger a browser download from a Blob object.
 */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Release the object URL after a short delay
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Upload a file via XHR so we can track progress.
 * Returns a Promise that resolves to { blob, filename } on success,
 * or rejects with an Error.
 */
function uploadFile(file, endpoint, onProgress) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint, true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const cd       = xhr.getResponseHeader('Content-Disposition') || '';
        const match    = cd.match(/filename="([^"]+)"/);
        const filename = match ? match[1] : (endpoint.includes('csv-to-edi') ? 'output.edi' : 'output.csv');
        resolve({ blob: new Blob([xhr.response]), filename });
      } else {
        // Server returned an error — try to parse JSON body
        try {
          const text = xhr.responseText;
          const json = JSON.parse(text);
          reject(new Error(json.error || `Server error ${xhr.status}`));
        } catch {
          reject(new Error(`Server error ${xhr.status}: ${xhr.statusText}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Network error — is the backend server running?'));
    xhr.responseType = 'arraybuffer';
    xhr.send(formData);
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Animated spinner (Tailwind + SVG) */
function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

/** Error alert banner */
function ErrorBanner({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-3 bg-red-50 border border-red-300 text-red-800 rounded-lg p-4 mt-4">
      <svg className="h-5 w-5 flex-shrink-0 mt-0.5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
      </svg>
      <div className="flex-1">
        <p className="font-semibold text-sm">Conversion Failed</p>
        <p className="text-sm mt-1 whitespace-pre-line">{message}</p>
      </div>
      <button onClick={onDismiss} className="text-red-400 hover:text-red-600 ml-auto flex-shrink-0">
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  );
}

/** Success flash banner */
function SuccessBanner({ filename, onDismiss }) {
  if (!filename) return null;
  return (
    <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-lg p-4 mt-4">
      <svg className="h-5 w-5 flex-shrink-0 mt-0.5 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
      <div className="flex-1">
        <p className="font-semibold text-sm">Conversion Successful</p>
        <p className="text-sm mt-1">
          <span className="font-mono bg-emerald-100 px-1 py-0.5 rounded">{filename}</span> has been downloaded to your browser.
        </p>
      </div>
      <button onClick={onDismiss} className="text-emerald-400 hover:text-emerald-600 ml-auto flex-shrink-0">
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  );
}

/** Upload progress bar */
function ProgressBar({ value }) {
  if (value === null) return null;
  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs text-slate-500 mb-1">
        <span>Uploading…</span>
        <span>{value}%</span>
      </div>
      <div className="w-full bg-slate-200 rounded-full h-1.5">
        <div
          className="bg-indigo-500 h-1.5 rounded-full transition-all duration-200"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [direction, setDirection]     = useState(DIRECTIONS.CSV_TO_EDI);
  const [file, setFile]               = useState(null);        // File object
  const [isDragging, setIsDragging]   = useState(false);
  const [isLoading, setIsLoading]     = useState(false);
  const [progress, setProgress]       = useState(null);        // 0-100 | null
  const [error, setError]             = useState('');
  const [successFile, setSuccessFile] = useState('');          // filename of last download

  const fileInputRef = useRef(null);

  // ── Direction toggle ────────────────────────────────────────────────────
  const handleDirectionChange = (newDir) => {
    setDirection(newDir);
    setFile(null);
    setError('');
    setSuccessFile('');
    setProgress(null);
  };

  // ── File selection (shared for drop + input) ───────────────────────────
  const handleFileSelect = useCallback((selectedFile) => {
    setError('');
    setSuccessFile('');
    const err = validateFile(selectedFile, direction);
    if (err) {
      setError(err);
      setFile(null);
      return;
    }
    setFile(selectedFile);
  }, [direction]);

  // ── Drag and drop handlers ─────────────────────────────────────────────
  const onDragOver  = (e) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const onDrop      = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFileSelect(dropped);
  };

  // ── Input change ───────────────────────────────────────────────────────
  const onInputChange = (e) => {
    const selected = e.target.files[0];
    if (selected) handleFileSelect(selected);
    // Reset so the same file can be re-selected after an error
    e.target.value = '';
  };

  // ── Conversion submit ──────────────────────────────────────────────────
  const handleConvert = async () => {
    if (!file) return;
    setError('');
    setSuccessFile('');
    setIsLoading(true);
    setProgress(0);

    const endpoint = `/api/convert/${direction}`;

    try {
      const { blob, filename } = await uploadFile(file, endpoint, setProgress);
      triggerDownload(blob, filename);
      setSuccessFile(filename);
      setFile(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
      setProgress(null);
    }
  };

  // ── Sample CSV download ────────────────────────────────────────────────
  const downloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
    triggerDownload(blob, 'sample_834_members.csv');
  };

  // ── Derived display values ─────────────────────────────────────────────
  const isCsvToEdi   = direction === DIRECTIONS.CSV_TO_EDI;
  const accepted     = ACCEPTED[direction];
  const dropLabel    = `Drop your ${accepted.label} file here`;
  const accept       = accepted.exts.join(',');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center p-4">
      <div className="w-full max-w-xl">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight">
            X12 834 Converter
          </h1>
          <p className="text-slate-500 mt-1 text-sm">
            HIPAA Benefit Enrollment &amp; Maintenance &mdash; bidirectional CSV ↔ EDI
          </p>
        </div>

        {/* ── Card ───────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8">

          {/* ── Direction toggle ─────────────────────────────────────── */}
          <div className="flex items-center justify-center gap-0 mb-6 bg-slate-100 rounded-xl p-1">
            <button
              onClick={() => handleDirectionChange(DIRECTIONS.CSV_TO_EDI)}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold transition-all duration-200 ${
                isCsvToEdi
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              CSV → EDI
            </button>
            <button
              onClick={() => handleDirectionChange(DIRECTIONS.EDI_TO_CSV)}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold transition-all duration-200 ${
                !isCsvToEdi
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              EDI → CSV
            </button>
          </div>

          {/* ── Direction description ─────────────────────────────────── */}
          <p className="text-xs text-slate-400 text-center -mt-3 mb-5">
            {isCsvToEdi
              ? 'Upload a CSV roster → download a HIPAA-compliant X12 834 EDI file'
              : 'Upload an X12 834 EDI file → download a flat CSV roster'}
          </p>

          {/* ── Drop zone ────────────────────────────────────────────── */}
          <div
            onClick={() => !isLoading && fileInputRef.current?.click()}
            onDragOver={!isLoading ? onDragOver : undefined}
            onDragLeave={!isLoading ? onDragLeave : undefined}
            onDrop={!isLoading ? onDrop : undefined}
            className={`
              relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer
              transition-all duration-200 select-none
              ${isLoading ? 'opacity-60 cursor-not-allowed' : 'hover:border-indigo-400 hover:bg-indigo-50'}
              ${isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-slate-50'}
              ${file ? 'border-emerald-400 bg-emerald-50' : ''}
            `}
          >
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              onChange={onInputChange}
              className="sr-only"
              disabled={isLoading}
            />

            {file ? (
              /* File selected state */
              <div className="flex flex-col items-center gap-2">
                <svg className="h-10 w-10 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="font-semibold text-slate-700 text-sm truncate max-w-xs">{file.name}</p>
                <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB &mdash; click to change</p>
              </div>
            ) : (
              /* Empty state */
              <div className="flex flex-col items-center gap-3">
                <svg className={`h-12 w-12 transition-colors ${isDragging ? 'text-indigo-500' : 'text-slate-300'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <div>
                  <p className="text-slate-600 font-medium text-sm">{dropLabel}</p>
                  <p className="text-slate-400 text-xs mt-1">or click to browse</p>
                </div>
                <span className="text-xs bg-slate-200 text-slate-500 px-2 py-1 rounded-full font-mono">
                  {accepted.exts.join('  ')}
                </span>
              </div>
            )}
          </div>

          {/* ── Progress bar ─────────────────────────────────────────── */}
          <ProgressBar value={progress} />

          {/* ── Error / success banners ───────────────────────────────── */}
          <ErrorBanner message={error} onDismiss={() => setError('')} />
          <SuccessBanner filename={successFile} onDismiss={() => setSuccessFile('')} />

          {/* ── Convert button ───────────────────────────────────────── */}
          <button
            onClick={handleConvert}
            disabled={!file || isLoading}
            className={`
              mt-5 w-full flex items-center justify-center gap-2
              py-3 px-6 rounded-xl font-semibold text-sm
              transition-all duration-200
              ${file && !isLoading
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md hover:shadow-lg active:scale-[0.98]'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'}
            `}
          >
            {isLoading ? (
              <>
                <Spinner />
                <span>Converting…</span>
              </>
            ) : (
              <>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                </svg>
                <span>Convert &amp; Download</span>
              </>
            )}
          </button>

          {/* ── Sample CSV link (only shown in CSV→EDI mode) ──────────── */}
          {isCsvToEdi && (
            <p className="mt-4 text-center text-xs text-slate-400">
              Not sure about the CSV format?{' '}
              <button
                onClick={downloadSample}
                className="text-indigo-500 hover:text-indigo-700 underline underline-offset-2 font-medium"
              >
                Download sample CSV
              </button>
            </p>
          )}
        </div>

        {/* ── Field reference (collapsible) ──────────────────────────── */}
        <details className="mt-6 bg-white rounded-2xl shadow-sm overflow-hidden">
          <summary className="cursor-pointer px-6 py-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-2 list-none">
            <svg className="h-4 w-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            CSV Field Reference
          </summary>
          <div className="px-6 pb-6 pt-2 overflow-x-auto">
            <table className="text-xs w-full border-collapse">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left p-2 font-semibold text-slate-600 border-b border-slate-200">Column</th>
                  <th className="text-left p-2 font-semibold text-slate-600 border-b border-slate-200">Required</th>
                  <th className="text-left p-2 font-semibold text-slate-600 border-b border-slate-200">Example / Notes</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {/* ── Required / core fields ─────────────────────────── */}
                {[
                  ['subscriber_id',                '✓', 'EMP001 — member plan ID (REF*0F)'],
                  ['first_name',                   '✓', 'Jane'],
                  ['last_name',                    '✓', 'Smith'],
                  ['middle_name',                  '',  'A'],
                  ['ssn',                          '',  '123456789 digits only (REF*SY / NM109)'],
                  ['dob',                          '✓', '1985-06-15 or 19850615'],
                  ['gender',                       '✓', 'M, F, or U'],
                  ['relationship_code',            '',  '18=Self  01=Spouse  19=Child (INS02)'],
                  ['maintenance_type_code',        '',  '021=Add  030=Change  024=Cancel (INS03)'],
                  ['maintenance_reason_code',      '',  '25=Active  20=Active Full-Time (INS04)'],
                  ['address1',                     '',  '100 Main St'],
                  ['address2',                     '',  'Apt 3G'],
                  ['city',                         '',  'Springfield'],
                  ['state',                        '',  'IL'],
                  ['zip',                          '',  '62701'],
                  ['phone',                        '',  '2175550100'],
                  ['email',                        '',  'jane@example.com'],
                  ['plan_id',                      '',  'PLAN-GOLD (HD04)'],
                  ['coverage_type_code',           '',  'HLT, DEN, VIS (HD03)'],
                  ['coverage_level_code',          '',  'EMP, FAM, ESP, ECH (HD05)'],
                  ['effective_date',               '✓', '2025-01-01 (DTP*348)'],
                  ['termination_date',             '',  '2025-12-31 (DTP*349)'],
                  ['employer_name',                '',  'Acme Corp (N1*P5)'],
                  ['employer_id',                  '',  'ACME001'],
                  ['payer_name',                   '',  'Blue Cross Blue Shield (N1*IN)'],
                  ['payer_id',                     '',  'BCBS001'],
                  ['group_number',                 '',  'GRP-2025 (REF*38 / REF*1L)'],
                  ['employment_status',            '',  'FT=Full-Time  PT=Part-Time (INS08)'],
                  // ── Extended INS elements ────────────────────────────
                  ['name_prefix',                  '',  'Mr. Dr. (NM106)'],
                  ['name_suffix',                  '',  'Jr. Sr. III (NM107)'],
                  ['marital_status',               '',  'I=Single  M=Married  (DMG04)'],
                  ['race_ethnicity_code',          '',  '7=Not Hispanic (DMG05)'],
                  ['citizenship_status_code',      '',  '1=US Citizen (DMG06)'],
                  ['student_status',               '',  'F=Full-Time  P=Part-Time (INS09)'],
                  ['handicap_indicator',           '',  'Y or N (INS10)'],
                  ['death_date',                   '',  '2025-03-15 (INS12)'],
                  ['confidentiality_code',         '',  'R=Restricted (INS13)'],
                  ['birth_sequence',               '',  '1 (INS17 — multiple births)'],
                  ['employment_begin_date',        '',  '2020-01-15 (DTP*336)'],
                  // ── Loop 2100B — Incorrect Name ─────────────────────
                  ['incorrect_last_name',          '',  'Old last name before correction (NM1*70)'],
                  ['incorrect_first_name',         '',  ''],
                  ['incorrect_dob',                '',  'Prior DOB on record'],
                  ['incorrect_gender',             '',  'Prior gender on record'],
                  // ── Loop 2100C — Mailing Address ────────────────────
                  ['mail_address1',                '',  'PO Box 100 (NM1*31 + N3/N4)'],
                  ['mail_address2 / city / state / zip', '', 'Separate mailing address'],
                  // ── Loop 2100D — Member Employer ────────────────────
                  ['emp_org_name',                 '',  'Employer legal name (NM1*36)'],
                  ['emp_org_id',                   '',  'EIN or other ID'],
                  ['emp_org_id_qual',              '',  'FI=Federal Tax ID (default)'],
                  ['emp_org_phone',                '',  'HR dept phone (PER*EP)'],
                  ['emp_org_address1 / city / state / zip', '', 'Employer address'],
                  // ── Loop 2100E/F/G/H ────────────────────────────────
                  ['school_name',                  '',  'School name for student (NM1*M8)'],
                  ['custodial_last_name / first_name', '', 'Custodial parent (NM1*S3)'],
                  ['responsible_entity_code',      '',  'QD=Other  GB=Guardian (NM1*xx)'],
                  ['responsible_last_name / first_name', '', 'Responsible person name'],
                  ['dropoff_location_name',        '',  'Day-care / drop-off site (NM1*45)'],
                  ['dropoff_address1 / city / state / zip', '', 'Drop-off address'],
                  // ── Loop 2200 — Disability ───────────────────────────
                  ['disability_type_code',         '',  '1=Illness  2=Injury  3=Pregnancy (DSB01)'],
                  ['disability_begin_date',        '',  '2024-06-01 (DTP*360)'],
                  ['disability_end_date',          '',  '2024-12-31 (DTP*361)'],
                  // ── Loop 2300 extras ────────────────────────────────
                  ['late_enrollment_indicator',    '',  'Y or N (HD09)'],
                  ['enrollment_signature_date',    '',  '2024-12-01 (DTP*300)'],
                  ['maintenance_effective_date',   '',  '2025-01-01 (DTP*303)'],
                  ['last_premium_paid_date',       '',  '2024-12-15 (DTP*543)'],
                  ['prior_coverage_months',        '',  '18 (REF*QQ)'],
                  ['coverage_amount_qualifier',    '',  'B9=Premium  FK=Deductible (AMT01)'],
                  ['coverage_amount',              '',  '450.00 (AMT02)'],
                  ['id_card_type',                 '',  'H=Health  D=Drug  P=Prescription (IDC02)'],
                  // ── Loop 2310 — Provider ────────────────────────────
                  ['provider_entity_code',         '',  'P3=PCP  FA=Facility  QA=Dentist (NM101)'],
                  ['provider_entity_type',         '',  '1=Person  2=Non-Person (NM102)'],
                  ['provider_last_name',           '',  'JOHNSON (NM103)'],
                  ['provider_first_name',          '',  'MARK (NM104)'],
                  ['provider_id_qual',             '',  'XX=NPI  SV=Service Provider (NM108)'],
                  ['provider_id',                  '',  '1234567890 (NM109)'],
                  ['provider_patient_status',      '',  '25=Not Yet Assigned  26=Enrolled (NM110)'],
                  // ── Loop 2320/2330 — COB ────────────────────────────
                  ['cob_payer_responsibility',     '',  'P=Primary  S=Secondary  T=Tertiary (COB01)'],
                  ['cob_group_number',             '',  'Other plan group # (COB02)'],
                  ['cob_code',                     '',  '1=Subscriber  5=Unknown (COB03)'],
                  ['cob_begin_date',               '',  '2025-01-01 (DTP*344)'],
                  ['cob_end_date',                 '',  '2025-12-31 (DTP*345)'],
                  ['cob_insurer_name',             '',  'Aetna (NM1*IN in 2330)'],
                  ['cob_insurer_id_qual',          '',  'XV=NAIC  FI=Federal Tax ID'],
                  ['cob_insurer_id',               '',  'AETNA001 (NM109)'],
                  ['cob_contact_phone',            '',  '8005551234 (PER*CN)'],
                  // ── Loop 2700 — Reporting Categories ────────────────
                  ['reporting_category',           '',  'Dept name or class (N1*75)'],
                  ['reporting_category_ref_qual',  '',  'ZZ=Mutually Defined  17=Dept (REF01)'],
                  ['reporting_category_ref_id',    '',  'DEPT-A (REF02)'],
                  ['reporting_category_date',      '',  '2025-01-01 (DTP*007)'],
                ].map(([col, req, note]) => (
                  <tr key={col} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="p-2 text-indigo-700">{col}</td>
                    <td className="p-2 text-center">{req}</td>
                    <td className="p-2 text-slate-500 font-sans">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <p className="text-center text-xs text-slate-400 mt-6">
          HIPAA X12 005010X220A1 &bull; Files processed in-memory &bull; No data stored on server
        </p>
      </div>
    </div>
  );
}
