/**
 * services/ediConverter.js
 *
 * Bidirectional conversion between flat CSV and HIPAA 834 (005010X220A1) EDI.
 *
 * Exported functions:
 *   convertCsvTo834(records)   — Array<Object> → EDI string
 *   convert834ToCsv(ediString) — EDI string    → Array<Object>
 *
 * X12 delimiters: * element  : composite  ~ segment terminator
 */

'use strict';

const { v4: uuidv4 } = require('uuid');

const EL  = '*';
const CO  = ':';
const SEG = '~';
const RESERVED_RE = /[*:~^|\\]/g;

// ── Utilities ────────────────────────────────────────────────────────────────

function sanitize(val) {
  if (val == null) return '';
  return String(val).trim().replace(RESERVED_RE, '');
}

function toX12Date(raw) {
  if (!raw) return '';
  const s = String(raw).trim().replace(/[^0-9/\-]/g, '');
  if (/^\d{8}$/.test(s)) return s;
  const iso = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (iso) return `${iso[1]}${iso[2]}${iso[3]}`;
  const us = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (us) return `${us[3]}${us[1]}${us[2]}`;
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  }
  throw new Error(`Cannot parse date: "${raw}". Use YYYY-MM-DD, MM/DD/YYYY, or YYYYMMDD.`);
}

function fromX12Date(x12) {
  if (!x12 || x12.length < 8) return x12 || '';
  return `${x12.slice(0,4)}-${x12.slice(4,6)}-${x12.slice(6,8)}`;
}

function pad(str, len) {
  return String(str || '').padEnd(len, ' ').slice(0, len);
}

function zeroPad(n, width) {
  return String(n).padStart(width, '0');
}

function seg(...elements) {
  let last = elements.length - 1;
  while (last > 0 && elements[last] === '') last--;
  return elements.slice(0, last + 1).join(EL) + SEG + '\n';
}

function validateRecord(r, idx) {
  const errors = [];
  for (const field of ['last_name', 'first_name', 'subscriber_id', 'dob', 'gender', 'effective_date']) {
    if (!sanitize(r[field])) errors.push(`Row ${idx + 1}: missing required field "${field}"`);
  }
  if (r.gender && !['M', 'F', 'U'].includes(String(r.gender).toUpperCase())) {
    errors.push(`Row ${idx + 1}: gender must be M, F, or U (got "${r.gender}")`);
  }
  return errors;
}

// ── CSV → 834 ────────────────────────────────────────────────────────────────

async function convertCsvTo834(records) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('No records provided for conversion.');
  }

  const rows = records.map(r =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase().replace(/\s+/g, '_'), v]))
  );

  const allErrors = rows.flatMap((r, i) => validateRecord(r, i));
  if (allErrors.length > 0) throw new Error(`Validation errors:\n${allErrors.join('\n')}`);

  const first      = rows[0];
  const senderId   = sanitize(first.employer_id)   || 'SENDER';
  const senderName = sanitize(first.employer_name) || 'SPONSOR';
  const payerId    = sanitize(first.payer_id)       || 'PAYER';
  const payerName  = sanitize(first.payer_name)     || 'PAYER';
  const groupNum   = sanitize(first.group_number)   || '';

  const now    = new Date();
  const today  = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const time   = `${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  const isaCtrl = zeroPad(Math.floor(Math.random() * 999999999), 9);
  const gsCtrl  = zeroPad(Math.floor(Math.random() * 99999), 5);
  const stCtrl  = '0001';

  const lines = [];
  let segmentCount = 0;
  const emit = (...args) => { lines.push(seg(...args)); segmentCount++; };

  // ISA (fixed-width 106-char)
  lines.push(`ISA${EL}00${EL}          ${EL}00${EL}          ${EL}ZZ${EL}${pad(senderId,15)}${EL}ZZ${EL}${pad(payerId,15)}${EL}${today.slice(2)}${EL}${time}${EL}^${EL}00501${EL}${isaCtrl}${EL}0${EL}P${EL}:${SEG}\n`);

  // GS
  lines.push(`GS${EL}BE${EL}${sanitize(first.employer_id)||'SENDER'}${EL}${sanitize(first.payer_id)||'PAYER'}${EL}${today}${EL}${time}${EL}${gsCtrl}${EL}X${EL}005010X220A1${SEG}\n`);

  // ST / BGN
  emit('ST', '834', stCtrl, '005010X220A1');
  const txnRef = uuidv4().replace(/-/g,'').slice(0,9).toUpperCase();
  emit('BGN', '00', txnRef, today, time, '', '', '', '2');

  if (groupNum) emit('REF', '38', groupNum);

  // Loop 1000A — Sponsor/Employer
  emit('N1', 'P5', sanitize(senderName), 'FI', sanitize(first.employer_id) || '');

  // Loop 1000B — Payer
  emit('N1', 'IN', sanitize(payerName), 'XV', sanitize(first.payer_id) || '');

  // ── Loop 2000 — one per member ───────────────────────────────────────────
  for (const r of rows) {
    const lastName   = sanitize(r.last_name).toUpperCase();
    const firstName  = sanitize(r.first_name).toUpperCase();
    const middleName = sanitize(r.middle_name).toUpperCase();
    const namePrefix = sanitize(r.name_prefix);
    const nameSuffix = sanitize(r.name_suffix);
    const subId      = sanitize(r.subscriber_id);
    const ssn        = sanitize(r.ssn).replace(/\D/g,'');
    const dob        = toX12Date(r.dob);
    const gender     = (sanitize(r.gender) || 'U').toUpperCase();

    const maintType   = sanitize(r.maintenance_type_code)   || '021';
    const maintReason = sanitize(r.maintenance_reason_code) || '';
    const relCode     = sanitize(r.relationship_code)       || '18';
    const effDate     = toX12Date(r.effective_date);
    const termDate    = r.termination_date ? toX12Date(r.termination_date) : '';
    const coverageCode = sanitize(r.coverage_type_code)  || 'HLT';
    const planId       = sanitize(r.plan_id)             || '';
    const covLevel     = sanitize(r.coverage_level_code) || 'EMP';

    const address1 = sanitize(r.address1);
    const address2 = sanitize(r.address2);
    const city     = sanitize(r.city);
    const state    = sanitize(r.state).toUpperCase();
    const zip      = sanitize(r.zip).replace(/\D/g,'').slice(0,9);
    const phone    = sanitize(r.phone).replace(/\D/g,'').slice(0,12);
    const email    = sanitize(r.email);

    // ── INS — employment status FIXED to INS-08 (was erroneously at INS-17) ─
    emit('INS',
      relCode === '18' ? 'Y' : 'N',      // INS01 subscriber indicator
      relCode,                            // INS02 relationship code
      maintType,                          // INS03 maintenance type
      maintReason,                        // INS04 maintenance reason
      'A',                                // INS05 benefit status (A=active)
      '',                                 // INS06 Medicare status (composite, omit)
      '',                                 // INS07 COBRA qualifying event
      sanitize(r.employment_status),      // INS08 employment status ← FIXED
      sanitize(r.student_status),         // INS09 student status (F/P)
      sanitize(r.handicap_indicator),     // INS10 handicap indicator (Y/N)
      r.death_date ? 'D8' : '',           // INS11 death date qualifier
      r.death_date ? toX12Date(r.death_date) : '', // INS12 death date
      sanitize(r.confidentiality_code),   // INS13 confidentiality code
      '',                                 // INS14 city (not used)
      '',                                 // INS15 state (not used)
      '',                                 // INS16 postal (not used)
      sanitize(r.birth_sequence)          // INS17 birth sequence number
    );

    // 2000-level REF
    if (subId) emit('REF', '0F', subId);
    if (r.group_number && sanitize(r.group_number) !== groupNum) emit('REF', '1L', sanitize(r.group_number));
    if (ssn)  emit('REF', 'SY', ssn);

    // 2000-level DTP
    if (r.employment_begin_date) emit('DTP', '336', 'D8', toX12Date(r.employment_begin_date));

    // ── Loop 2100A — Member Name (NM1*IL) ───────────────────────────────────
    const nmIdQual = ssn ? '34' : (subId ? 'ZZ' : '');
    const nmIdCode = ssn ? ssn  : subId;
    emit('NM1', 'IL', '1', lastName, firstName, middleName, namePrefix, nameSuffix, nmIdQual, nmIdCode);

    if (phone || email) {
      // PER02 = contact name (blank); PER03+ = comm qualifier/value pairs
      const pe = ['IP', ''];
      if (phone) pe.push('HP', phone);
      if (email) pe.push('EM', email);
      emit('PER', ...pe);
    }

    if (address1) emit('N3', address1, address2);
    if (city || state || zip) emit('N4', city, state, zip);

    // DMG — extended with marital status, race/ethnicity, citizenship
    if (dob || gender) {
      emit('DMG', 'D8', dob, gender,
        sanitize(r.marital_status),
        sanitize(r.race_ethnicity_code),
        sanitize(r.citizenship_status_code)
      );
    }

    // ── Loop 2100B — Incorrect Member Name (NM1*70) ─────────────────────────
    if (sanitize(r.incorrect_last_name)) {
      emit('NM1', '70', '1',
        sanitize(r.incorrect_last_name).toUpperCase(),
        sanitize(r.incorrect_first_name).toUpperCase()
      );
      const incDob    = r.incorrect_dob    ? toX12Date(r.incorrect_dob) : '';
      const incGender = sanitize(r.incorrect_gender).toUpperCase();
      if (incDob || incGender) emit('DMG', 'D8', incDob, incGender);
    }

    // ── Loop 2100C — Member Mailing Address (NM1*31) ────────────────────────
    if (sanitize(r.mail_address1)) {
      emit('NM1', '31', '1');
      emit('N3', sanitize(r.mail_address1), sanitize(r.mail_address2));
      emit('N4',
        sanitize(r.mail_city),
        sanitize(r.mail_state).toUpperCase(),
        sanitize(r.mail_zip).replace(/\D/g,'').slice(0,9)
      );
    }

    // ── Loop 2100D — Member Employer (NM1*36) ───────────────────────────────
    if (sanitize(r.emp_org_name)) {
      const empIdQual = sanitize(r.emp_org_id_qual) || 'FI';
      emit('NM1', '36', '2',
        sanitize(r.emp_org_name).toUpperCase(),
        '', '', '', '',
        empIdQual,
        sanitize(r.emp_org_id)
      );
      if (sanitize(r.emp_org_phone)) {
        emit('PER', 'EP', '', 'TE', sanitize(r.emp_org_phone).replace(/\D/g,'').slice(0,12));
      }
      if (sanitize(r.emp_org_address1)) {
        emit('N3', sanitize(r.emp_org_address1));
        emit('N4',
          sanitize(r.emp_org_city),
          sanitize(r.emp_org_state).toUpperCase(),
          sanitize(r.emp_org_zip).replace(/\D/g,'').slice(0,9)
        );
      }
    }

    // ── Loop 2100E — Member School (NM1*M8) ─────────────────────────────────
    if (sanitize(r.school_name)) {
      emit('NM1', 'M8', '2', sanitize(r.school_name).toUpperCase());
    }

    // ── Loop 2100F — Custodial Parent (NM1*S3) ──────────────────────────────
    if (sanitize(r.custodial_last_name)) {
      emit('NM1', 'S3', '1',
        sanitize(r.custodial_last_name).toUpperCase(),
        sanitize(r.custodial_first_name).toUpperCase()
      );
    }

    // ── Loop 2100G — Responsible Person ─────────────────────────────────────
    if (sanitize(r.responsible_last_name)) {
      const respCode = sanitize(r.responsible_entity_code) || 'QD';
      emit('NM1', respCode, '1',
        sanitize(r.responsible_last_name).toUpperCase(),
        sanitize(r.responsible_first_name).toUpperCase()
      );
    }

    // ── Loop 2100H — Drop-Off Location (NM1*45) ─────────────────────────────
    if (sanitize(r.dropoff_location_name)) {
      emit('NM1', '45', '2', sanitize(r.dropoff_location_name).toUpperCase());
      if (sanitize(r.dropoff_address1)) {
        emit('N3', sanitize(r.dropoff_address1));
        emit('N4',
          sanitize(r.dropoff_city),
          sanitize(r.dropoff_state).toUpperCase(),
          sanitize(r.dropoff_zip).replace(/\D/g,'').slice(0,9)
        );
      }
    }

    // ── Loop 2200 — Disability (DSB) ────────────────────────────────────────
    if (sanitize(r.disability_type_code)) {
      emit('DSB', sanitize(r.disability_type_code));
      if (r.disability_begin_date) emit('DTP', '360', 'D8', toX12Date(r.disability_begin_date));
      if (r.disability_end_date)   emit('DTP', '361', 'D8', toX12Date(r.disability_end_date));
    }

    // ── Loop 2300 — Health Coverage (HD) ────────────────────────────────────
    const lateEnroll = sanitize(r.late_enrollment_indicator);
    // HD01=maint type, HD02=unused, HD03=insurance line, HD04=plan id, HD05=coverage level
    // HD06-08=unused, HD09=late enrollment indicator
    emit('HD', maintType, '', coverageCode, planId, covLevel, '', '', '', lateEnroll);

    if (effDate)  emit('DTP', '348', 'D8', effDate);   // benefit begin
    if (termDate) emit('DTP', '349', 'D8', termDate);  // benefit end
    if (r.enrollment_signature_date)  emit('DTP', '300', 'D8', toX12Date(r.enrollment_signature_date));
    if (r.maintenance_effective_date) emit('DTP', '303', 'D8', toX12Date(r.maintenance_effective_date));
    if (r.last_premium_paid_date)     emit('DTP', '543', 'D8', toX12Date(r.last_premium_paid_date));

    if (sanitize(r.prior_coverage_months)) emit('REF', 'QQ', sanitize(r.prior_coverage_months));

    if (sanitize(r.coverage_amount_qualifier) && sanitize(r.coverage_amount)) {
      emit('AMT', sanitize(r.coverage_amount_qualifier), sanitize(r.coverage_amount));
    }

    // IDC — ID card: IDC01=card ref id (blank), IDC02=card type (D/H/P), IDC03=count
    if (sanitize(r.id_card_type)) {
      emit('IDC', '', sanitize(r.id_card_type), '1');
    }

    // ── Loop 2310 — Provider Information ────────────────────────────────────
    if (sanitize(r.provider_entity_code)) {
      emit('LX', '1');
      emit('NM1',
        sanitize(r.provider_entity_code),             // NM101 entity qualifier
        sanitize(r.provider_entity_type) || '1',      // NM102 entity type (1=person, 2=non-person)
        sanitize(r.provider_last_name).toUpperCase(),  // NM103 last name / org name
        sanitize(r.provider_first_name).toUpperCase(), // NM104 first name
        '',                                            // NM105 middle name
        '',                                            // NM106 prefix
        '',                                            // NM107 suffix
        sanitize(r.provider_id_qual),                  // NM108 id qualifier
        sanitize(r.provider_id),                       // NM109 id
        sanitize(r.provider_patient_status)            // NM110 patient status (25/26/72)
      );
    }

    // ── Loop 2320 — COB ─────────────────────────────────────────────────────
    if (sanitize(r.cob_payer_responsibility)) {
      emit('COB',
        sanitize(r.cob_payer_responsibility), // COB01 P/S/T/U
        sanitize(r.cob_group_number),         // COB02 policy/group number
        sanitize(r.cob_code)                  // COB03 coordination of benefits code
      );
      if (r.cob_begin_date) emit('DTP', '344', 'D8', toX12Date(r.cob_begin_date));
      if (r.cob_end_date)   emit('DTP', '345', 'D8', toX12Date(r.cob_end_date));

      // ── Loop 2330 — COB Related Entity ──────────────────────────────────
      if (sanitize(r.cob_insurer_name)) {
        const cobIdQual = sanitize(r.cob_insurer_id_qual) || 'XV';
        emit('NM1', 'IN', '2',
          sanitize(r.cob_insurer_name).toUpperCase(),
          '', '', '', '',
          cobIdQual,
          sanitize(r.cob_insurer_id)
        );
        if (sanitize(r.cob_contact_phone)) {
          emit('PER', 'CN', '', 'TE', sanitize(r.cob_contact_phone).replace(/\D/g,'').slice(0,12));
        }
      }
    }

    // ── Loop 2700 — Reporting Categories (LS/LE envelope) ───────────────────
    if (sanitize(r.reporting_category)) {
      emit('LS', '2700');
      emit('LX', '1');
      emit('N1', '75', sanitize(r.reporting_category));
      if (sanitize(r.reporting_category_ref_qual) && sanitize(r.reporting_category_ref_id)) {
        emit('REF', sanitize(r.reporting_category_ref_qual), sanitize(r.reporting_category_ref_id));
      }
      if (r.reporting_category_date) {
        emit('DTP', '007', 'D8', toX12Date(r.reporting_category_date));
      }
      emit('LE', '2700');
    }
  }

  // SE — count includes ST and SE themselves
  const seCount = segmentCount + 1;
  lines.push(seg('SE', String(seCount), stCtrl));

  lines.push(`GE${EL}1${EL}${gsCtrl}${SEG}\n`);
  lines.push(`IEA${EL}1${EL}${isaCtrl}${SEG}\n`);

  return lines.join('');
}

// ── 834 → CSV ────────────────────────────────────────────────────────────────

// NM1 entity codes used in Loop 2100G (Responsible Person)
const RESP_PERSON_CODES = new Set(['6Y','9K','E1','EI','EXS','GB','GD','J6','LR','QD','S1','TZ','X4']);

async function convert834ToCsv(ediString) {
  if (!ediString || typeof ediString !== 'string') {
    throw new Error('EDI input must be a non-empty string.');
  }

  // Auto-detect delimiters from fixed-width ISA header
  const isaRaw     = ediString.slice(0, 110);
  const elementSep = isaRaw[3]   || EL;
  const segTerm    = isaRaw[105] || SEG;

  const rawSegments = ediString
    .split(segTerm)
    .map(s => s.replace(/^\s+|\s+$/g, ''))
    .filter(Boolean);

  if (rawSegments.length < 3) {
    throw new Error('EDI file appears malformed: fewer than 3 segments found.');
  }

  const segments = rawSegments.map(raw => {
    const parts = raw.split(elementSep);
    return { id: parts[0].toUpperCase().trim(), elements: parts };
  });

  // Extract envelope-level defaults from 1000A/1000B N1 segments
  let employerName = '', employerId = '', payerName = '', payerId = '', groupNum = '';

  for (const s of segments) {
    if (s.id === 'GS') {
      employerId = s.elements[2] || '';
      payerId    = s.elements[3] || '';
    }
    if (s.id === 'N1') {
      const qual = (s.elements[1] || '').toUpperCase();
      if (qual === 'P5' || qual === 'AY') {
        employerName = s.elements[2] || '';
        employerId   = s.elements[4] || employerId;
      }
      if (qual === 'IN' || qual === 'PR') {
        payerName = s.elements[2] || '';
        payerId   = s.elements[4] || payerId;
      }
    }
    if (s.id === 'REF' && (s.elements[1] || '').toUpperCase() === '38') {
      groupNum = s.elements[2] || '';
    }
  }

  const records  = [];
  let current    = null;
  let loopCtx    = 'PRE'; // tracks which loop/sub-loop we're currently in
  let inCob      = false; // true between COB and next non-COB segment that exits 2320
  let in2700     = false; // true between LS*2700 and LE*2700

  const pushCurrent = () => {
    if (current) {
      current.employer_name = current.employer_name || employerName;
      current.employer_id   = current.employer_id   || employerId;
      current.payer_name    = current.payer_name    || payerName;
      current.payer_id      = current.payer_id      || payerId;
      current.group_number  = current.group_number  || groupNum;
      records.push(current);
      current = null;
    }
  };

  const emptyRecord = () => ({
    // 2000 — INS
    relationship_code: '', maintenance_type_code: '', maintenance_reason_code: '',
    employment_status: '', student_status: '', handicap_indicator: '',
    death_date: '', confidentiality_code: '', birth_sequence: '',
    // 2000 — REF / DTP
    subscriber_id: '', ssn: '', group_number: '', employment_begin_date: '',
    // 2100A — NM1*IL
    last_name: '', first_name: '', middle_name: '', name_prefix: '', name_suffix: '',
    // 2100A — PER / N3 / N4
    phone: '', email: '', address1: '', address2: '', city: '', state: '', zip: '',
    // 2100A — DMG
    dob: '', gender: '', marital_status: '', race_ethnicity_code: '', citizenship_status_code: '',
    // 2100B — NM1*70
    incorrect_last_name: '', incorrect_first_name: '', incorrect_dob: '', incorrect_gender: '',
    // 2100C — NM1*31
    mail_address1: '', mail_address2: '', mail_city: '', mail_state: '', mail_zip: '',
    // 2100D — NM1*36
    emp_org_name: '', emp_org_id: '', emp_org_id_qual: '', emp_org_phone: '',
    emp_org_address1: '', emp_org_city: '', emp_org_state: '', emp_org_zip: '',
    // 2100E — NM1*M8
    school_name: '',
    // 2100F — NM1*S3
    custodial_last_name: '', custodial_first_name: '',
    // 2100G
    responsible_entity_code: '', responsible_last_name: '', responsible_first_name: '',
    // 2100H — NM1*45
    dropoff_location_name: '', dropoff_address1: '', dropoff_city: '', dropoff_state: '', dropoff_zip: '',
    // 2200 — DSB
    disability_type_code: '', disability_begin_date: '', disability_end_date: '',
    // 2300 — HD
    coverage_type_code: '', plan_id: '', coverage_level_code: '', late_enrollment_indicator: '',
    // 2300 — DTP
    effective_date: '', termination_date: '',
    enrollment_signature_date: '', maintenance_effective_date: '', last_premium_paid_date: '',
    // 2300 — REF / AMT / IDC
    prior_coverage_months: '', coverage_amount_qualifier: '', coverage_amount: '', id_card_type: '',
    // 2310 — Provider
    provider_entity_code: '', provider_entity_type: '', provider_last_name: '', provider_first_name: '',
    provider_id_qual: '', provider_id: '', provider_patient_status: '',
    // 2320/2330 — COB
    cob_payer_responsibility: '', cob_group_number: '', cob_code: '',
    cob_begin_date: '', cob_end_date: '',
    cob_insurer_name: '', cob_insurer_id_qual: '', cob_insurer_id: '', cob_contact_phone: '',
    // 2700
    reporting_category: '', reporting_category_ref_qual: '', reporting_category_ref_id: '', reporting_category_date: '',
    // envelope
    employer_name: '', employer_id: '', payer_name: '', payer_id: '',
  });

  for (const s of segments) {
    switch (s.id) {

      // ── Loop 2000 open ────────────────────────────────────────────────────
      case 'INS': {
        pushCurrent();
        loopCtx = '2000';
        inCob   = false;
        in2700  = false;
        current = emptyRecord();
        current.relationship_code       = s.elements[2]  || '';
        current.maintenance_type_code   = s.elements[3]  || '';
        current.maintenance_reason_code = s.elements[4]  || '';
        current.employment_status       = s.elements[8]  || ''; // INS08 ← fixed
        current.student_status          = s.elements[9]  || '';
        current.handicap_indicator      = s.elements[10] || '';
        current.death_date              = fromX12Date(s.elements[12] || '');
        current.confidentiality_code    = s.elements[13] || '';
        current.birth_sequence          = s.elements[17] || '';
        break;
      }

      // ── REF — route by loop context ───────────────────────────────────────
      case 'REF': {
        if (!current) break;
        const q = (s.elements[1] || '').toUpperCase();
        if (loopCtx === '2000' || loopCtx === '2100A') {
          if (q === '0F') current.subscriber_id = s.elements[2] || '';
          if (q === 'SY') current.ssn           = s.elements[2] || '';
          if (q === '1L') current.group_number  = s.elements[2] || '';
        }
        if (loopCtx === '2300') {
          if (q === 'QQ') current.prior_coverage_months = s.elements[2] || '';
        }
        if (in2700) {
          current.reporting_category_ref_qual = s.elements[1] || '';
          current.reporting_category_ref_id   = s.elements[2] || '';
        }
        break;
      }

      // ── DTP — route by loop context ───────────────────────────────────────
      case 'DTP': {
        if (!current) break;
        const q    = (s.elements[1] || '').toUpperCase();
        const date = fromX12Date(s.elements[3] || '');
        if (loopCtx === '2000') {
          if (q === '336') current.employment_begin_date = date;
        }
        if (loopCtx === '2200') {
          if (q === '360') current.disability_begin_date = date;
          if (q === '361') current.disability_end_date   = date;
        }
        if (loopCtx === '2300') {
          if (q === '348') current.effective_date             = date;
          if (q === '349') current.termination_date           = date;
          if (q === '300') current.enrollment_signature_date  = date;
          if (q === '303') current.maintenance_effective_date = date;
          if (q === '543') current.last_premium_paid_date     = date;
        }
        if (loopCtx === '2320') {
          if (q === '344') current.cob_begin_date = date;
          if (q === '345') current.cob_end_date   = date;
        }
        if (in2700) {
          if (q === '007') current.reporting_category_date = date;
        }
        break;
      }

      // ── NM1 — entity name segments ────────────────────────────────────────
      case 'NM1': {
        if (!current) break;
        const q = (s.elements[1] || '').toUpperCase();

        if (q === 'IL') {
          loopCtx = '2100A';
          inCob   = false;
          current.last_name   = s.elements[3] || '';
          current.first_name  = s.elements[4] || '';
          current.middle_name = s.elements[5] || '';
          current.name_prefix = s.elements[6] || '';
          current.name_suffix = s.elements[7] || '';
          const idQual = (s.elements[8] || '').toUpperCase();
          const idVal  = s.elements[9] || '';
          if (idQual === '34' && !current.ssn)           current.ssn           = idVal;
          if (idQual === 'ZZ' && !current.subscriber_id) current.subscriber_id = idVal;
        }
        else if (q === '70') {
          loopCtx = '2100B';
          current.incorrect_last_name  = s.elements[3] || '';
          current.incorrect_first_name = s.elements[4] || '';
        }
        else if (q === '31') {
          loopCtx = '2100C';
        }
        else if (q === '36') {
          loopCtx = '2100D';
          current.emp_org_name    = s.elements[3] || '';
          current.emp_org_id_qual = s.elements[8] || '';
          current.emp_org_id      = s.elements[9] || '';
        }
        else if (q === 'M8') {
          loopCtx = '2100E';
          current.school_name = s.elements[3] || '';
        }
        else if (q === 'S3') {
          loopCtx = '2100F';
          current.custodial_last_name  = s.elements[3] || '';
          current.custodial_first_name = s.elements[4] || '';
        }
        else if (q === '45') {
          loopCtx = '2100H';
          current.dropoff_location_name = s.elements[3] || '';
        }
        else if (RESP_PERSON_CODES.has(q)) {
          loopCtx = '2100G';
          current.responsible_entity_code  = q;
          current.responsible_last_name    = s.elements[3] || '';
          current.responsible_first_name   = s.elements[4] || '';
        }
        else if (inCob) {
          // NM1 inside COB context → 2330 COB related entity
          loopCtx = '2330';
          current.cob_insurer_name    = s.elements[3] || '';
          current.cob_insurer_id_qual = s.elements[8] || '';
          current.cob_insurer_id      = s.elements[9] || '';
        }
        else if (loopCtx === '2310') {
          // Provider NM1 follows LX inside 2300
          current.provider_entity_code    = q;
          current.provider_entity_type    = s.elements[2]  || '';
          current.provider_last_name      = s.elements[3]  || '';
          current.provider_first_name     = s.elements[4]  || '';
          current.provider_id_qual        = s.elements[8]  || '';
          current.provider_id             = s.elements[9]  || '';
          current.provider_patient_status = s.elements[10] || '';
        }
        break;
      }

      // ── PER — route by loop context ───────────────────────────────────────
      case 'PER': {
        if (!current) break;
        const func = (s.elements[1] || '').toUpperCase();
        const commPairs = (arr, offset) => {
          const out = {};
          for (let i = offset; i < arr.length - 1; i += 2) {
            const t = (arr[i] || '').toUpperCase();
            const v = arr[i + 1] || '';
            if (t === 'HP' || t === 'TE') out.phone = v;
            if (t === 'EM')               out.email = v;
          }
          return out;
        };

        if (loopCtx === '2100A' && func === 'IP') {
          const vals = commPairs(s.elements, 3);
          if (vals.phone) current.phone = vals.phone;
          if (vals.email) current.email = vals.email;
        }
        else if (loopCtx === '2100D' && func === 'EP') {
          for (let i = 3; i < s.elements.length - 1; i += 2) {
            const t = (s.elements[i] || '').toUpperCase();
            if (t === 'TE' || t === 'HP') current.emp_org_phone = s.elements[i + 1] || '';
          }
        }
        else if (loopCtx === '2330' && func === 'CN') {
          for (let i = 3; i < s.elements.length - 1; i += 2) {
            const t = (s.elements[i] || '').toUpperCase();
            if (t === 'TE' || t === 'HP') current.cob_contact_phone = s.elements[i + 1] || '';
          }
        }
        break;
      }

      // ── N3 — street address, routed by context ────────────────────────────
      case 'N3': {
        if (!current) break;
        if (loopCtx === '2100A') {
          current.address1 = s.elements[1] || '';
          current.address2 = s.elements[2] || '';
        } else if (loopCtx === '2100C') {
          current.mail_address1 = s.elements[1] || '';
          current.mail_address2 = s.elements[2] || '';
        } else if (loopCtx === '2100D') {
          current.emp_org_address1 = s.elements[1] || '';
        } else if (loopCtx === '2100H') {
          current.dropoff_address1 = s.elements[1] || '';
        }
        break;
      }

      // ── N4 — city/state/zip, routed by context ────────────────────────────
      case 'N4': {
        if (!current) break;
        if (loopCtx === '2100A') {
          current.city  = s.elements[1] || '';
          current.state = s.elements[2] || '';
          current.zip   = s.elements[3] || '';
        } else if (loopCtx === '2100C') {
          current.mail_city  = s.elements[1] || '';
          current.mail_state = s.elements[2] || '';
          current.mail_zip   = s.elements[3] || '';
        } else if (loopCtx === '2100D') {
          current.emp_org_city  = s.elements[1] || '';
          current.emp_org_state = s.elements[2] || '';
          current.emp_org_zip   = s.elements[3] || '';
        } else if (loopCtx === '2100H') {
          current.dropoff_city  = s.elements[1] || '';
          current.dropoff_state = s.elements[2] || '';
          current.dropoff_zip   = s.elements[3] || '';
        }
        break;
      }

      // ── DMG — demographics, routed by context ─────────────────────────────
      case 'DMG': {
        if (!current) break;
        if (loopCtx === '2100A') {
          current.dob                     = fromX12Date(s.elements[2] || '');
          current.gender                  = s.elements[3] || '';
          current.marital_status          = s.elements[4] || '';
          current.race_ethnicity_code     = s.elements[5] || '';
          current.citizenship_status_code = s.elements[6] || '';
        } else if (loopCtx === '2100B') {
          current.incorrect_dob    = fromX12Date(s.elements[2] || '');
          current.incorrect_gender = s.elements[3] || '';
        }
        break;
      }

      // ── DSB — Disability ──────────────────────────────────────────────────
      case 'DSB': {
        if (!current) break;
        loopCtx = '2200';
        current.disability_type_code = s.elements[1] || '';
        break;
      }

      // ── HD — Health Coverage (opens Loop 2300) ────────────────────────────
      case 'HD': {
        if (!current) break;
        loopCtx = '2300';
        inCob   = false;
        current.coverage_type_code        = s.elements[3] || '';
        current.plan_id                   = s.elements[4] || '';
        current.coverage_level_code       = s.elements[5] || '';
        current.late_enrollment_indicator = s.elements[9] || '';
        break;
      }

      // ── AMT — monetary amounts ─────────────────────────────────────────────
      case 'AMT': {
        if (!current || loopCtx !== '2300') break;
        current.coverage_amount_qualifier = s.elements[1] || '';
        current.coverage_amount           = s.elements[2] || '';
        break;
      }

      // ── IDC — ID card ─────────────────────────────────────────────────────
      case 'IDC': {
        if (!current) break;
        // IDC02 = card type (D/H/P)
        current.id_card_type = s.elements[2] || '';
        break;
      }

      // ── LX — sequential number, triggers 2310 or stays in 2700 ───────────
      case 'LX': {
        if (!current) break;
        if (loopCtx === '2300') loopCtx = '2310';
        // LX inside 2700 is handled implicitly (N1*75 follows)
        break;
      }

      // ── COB — opens Loop 2320 ─────────────────────────────────────────────
      case 'COB': {
        if (!current) break;
        loopCtx = '2320';
        inCob   = true;
        current.cob_payer_responsibility = s.elements[1] || '';
        current.cob_group_number         = s.elements[2] || '';
        current.cob_code                 = s.elements[3] || '';
        break;
      }

      // ── LS — Loop Header (2700) ───────────────────────────────────────────
      case 'LS': {
        if (!current) break;
        if ((s.elements[1] || '') === '2700') in2700 = true;
        break;
      }

      // ── LE — Loop Trailer (2700) ──────────────────────────────────────────
      case 'LE': {
        if (!current) break;
        if ((s.elements[1] || '') === '2700') in2700 = false;
        break;
      }

      // ── N1 — heading-level name (1000A/1000B) or 2700 reporting category ──
      case 'N1': {
        if (!current) break;
        if (in2700 && (s.elements[1] || '').toUpperCase() === '75') {
          current.reporting_category = s.elements[2] || '';
        }
        break;
      }

      default:
        break;
    }
  }

  pushCurrent();

  if (records.length === 0) {
    throw new Error('No member records (INS segments) found in the EDI file.');
  }

  return records;
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = { convertCsvTo834, convert834ToCsv };
