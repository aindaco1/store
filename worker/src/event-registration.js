const EVENT_REGISTRATION_VERSION = 1;
const EVENT_REGISTRATION_MAX_PARTY_SIZE = 20;
const EVENT_REGISTRATION_MAX_QUESTIONS = 12;
const EVENT_REGISTRATION_MAX_NAME_LENGTH = 120;
const EVENT_REGISTRATION_MAX_LABEL_LENGTH = 160;
const EVENT_REGISTRATION_MAX_OPTION_LENGTH = 120;
const EVENT_REGISTRATION_MAX_TEXT_LENGTH = 2000;

const QUESTION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const QUESTION_TYPES = new Set(['text', 'textarea', 'single_select', 'multi_select', 'checkbox']);
const QUESTION_SCOPES = new Set(['party', 'attendee']);

export {
  EVENT_REGISTRATION_MAX_PARTY_SIZE,
  EVENT_REGISTRATION_MAX_QUESTIONS,
  EVENT_REGISTRATION_VERSION
};

export function normalizeEventRegistrationConfig(eventDetails = null) {
  const raw = eventDetails && typeof eventDetails === 'object' && !Array.isArray(eventDetails)
    ? (eventDetails.registration || eventDetails.rsvp_registration || eventDetails.rsvpRegistration)
    : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { configured: false, config: null, errors: [] };
  }

  const errors = [];
  const questions = [];
  const seenQuestionIds = new Set();
  const rawQuestions = Array.isArray(raw.questions) ? raw.questions : [];

  if (rawQuestions.length > EVENT_REGISTRATION_MAX_QUESTIONS) {
    errors.push(issue(
      'registration_questions_excessive',
      `RSVP registration supports at most ${EVENT_REGISTRATION_MAX_QUESTIONS} questions.`
    ));
  }

  rawQuestions.slice(0, EVENT_REGISTRATION_MAX_QUESTIONS).forEach((question, index) => {
    const normalized = normalizeQuestion(question, index);
    if (!normalized.ok) {
      errors.push(...normalized.errors);
      return;
    }
    if (seenQuestionIds.has(normalized.question.id)) {
      errors.push(issue(
        'registration_question_duplicate',
        'RSVP question IDs must be unique.',
        { questionId: normalized.question.id, questionIndex: index }
      ));
      return;
    }
    seenQuestionIds.add(normalized.question.id);
    questions.push(normalized.question);
  });

  const opensAt = normalizeDateTime(raw.opens_at ?? raw.opensAt, 'opens', errors);
  const closesAt = normalizeDateTime(raw.closes_at ?? raw.closesAt, 'closes', errors);
  if (opensAt && closesAt && Date.parse(opensAt) >= Date.parse(closesAt)) {
    errors.push(issue(
      'registration_window_invalid',
      'RSVP registration must close after it opens.'
    ));
  }

  const maxPartySize = normalizePartySize(raw.max_party_size ?? raw.maxPartySize, errors);
  const requireAttendeeNames = normalizeBoolean(
    raw.require_attendee_names ?? raw.requireAttendeeNames,
    true
  );
  const requireContactName = normalizeBoolean(
    raw.require_contact_name ?? raw.requireContactName,
    true
  );

  return {
    configured: true,
    config: {
      version: EVENT_REGISTRATION_VERSION,
      opensAt,
      closesAt,
      maxPartySize,
      requireAttendeeNames,
      requireContactName,
      questions
    },
    errors
  };
}

export function validateEventRegistrationSubmission({
  eventDetails = null,
  fulfillmentType = '',
  quantity = 1,
  submission = null,
  enforceSubmission = false,
  nowMs = Date.now()
} = {}) {
  if (normalizeString(fulfillmentType).toLowerCase() !== 'rsvp') {
    return { configured: false, config: null, registration: null, errors: [], warnings: [] };
  }

  const normalizedConfig = normalizeEventRegistrationConfig(eventDetails);
  if (!normalizedConfig.configured) {
    return { configured: false, config: null, registration: null, errors: [], warnings: [] };
  }

  const config = normalizedConfig.config;
  const errors = [...normalizedConfig.errors];
  const warnings = [];
  const safeQuantity = normalizePositiveInteger(quantity);
  const currentTime = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();

  if (config.opensAt && currentTime < Date.parse(config.opensAt)) {
    errors.push(issue('registration_not_open', 'RSVP registration is not open yet.', {
      opensAt: config.opensAt
    }));
  }
  if (config.closesAt && currentTime >= Date.parse(config.closesAt)) {
    errors.push(issue('registration_closed', 'RSVP registration is closed.', {
      closesAt: config.closesAt
    }));
  }
  if (safeQuantity > config.maxPartySize) {
    errors.push(issue(
      'registration_party_too_large',
      `This RSVP allows at most ${config.maxPartySize} attendees per registration.`,
      { requestedQuantity: safeQuantity, maxPartySize: config.maxPartySize }
    ));
  }

  const rawSubmission = submission && typeof submission === 'object' && !Array.isArray(submission)
    ? submission
    : null;
  const requiresAttendeeRows = config.requireAttendeeNames || config.questions.some((question) => question.scope === 'attendee');

  if (!rawSubmission && !enforceSubmission) {
    return { configured: true, config, registration: null, errors, warnings };
  }
  if (!rawSubmission) {
    errors.push(issue('registration_required', 'Complete the RSVP attendee information to continue.'));
    return { configured: true, config, registration: null, errors, warnings };
  }

  const attendees = [];
  const rawAttendees = Array.isArray(rawSubmission.attendees) ? rawSubmission.attendees : [];
  if (requiresAttendeeRows && rawAttendees.length !== safeQuantity) {
    errors.push(issue(
      'registration_attendee_count_mismatch',
      'Provide attendee information for each RSVP spot.',
      { expectedAttendees: safeQuantity, submittedAttendees: rawAttendees.length }
    ));
  }

  const attendeeQuestions = config.questions.filter((question) => question.scope === 'attendee');
  for (let index = 0; index < Math.min(rawAttendees.length, safeQuantity); index += 1) {
    const rawAttendee = rawAttendees[index] && typeof rawAttendees[index] === 'object'
      ? rawAttendees[index]
      : {};
    const name = boundedText(rawAttendee.name, EVENT_REGISTRATION_MAX_NAME_LENGTH);
    if (config.requireAttendeeNames && !name) {
      errors.push(issue(
        'registration_attendee_name_required',
        'Enter a name for each attendee.',
        { attendeeIndex: index }
      ));
    }
    attendees.push({
      id: `attendee-${index + 1}`,
      name,
      answers: normalizeAnswers(rawAttendee.answers, attendeeQuestions, errors, { attendeeIndex: index })
    });
  }

  const partyQuestions = config.questions.filter((question) => question.scope === 'party');
  const answers = normalizeAnswers(rawSubmission.answers, partyQuestions, errors);

  return {
    configured: true,
    config,
    registration: {
      version: EVENT_REGISTRATION_VERSION,
      answers,
      attendees
    },
    errors,
    warnings
  };
}

export function normalizeStoredEventRegistration(registration = null) {
  if (!registration || typeof registration !== 'object' || Array.isArray(registration)) return null;
  const attendees = Array.isArray(registration.attendees)
    ? registration.attendees.slice(0, EVENT_REGISTRATION_MAX_PARTY_SIZE).map((attendee, index) => ({
        id: normalizeString(attendee?.id) || `attendee-${index + 1}`,
        name: boundedText(attendee?.name, EVENT_REGISTRATION_MAX_NAME_LENGTH),
        answers: normalizeStoredAnswers(attendee?.answers)
      }))
    : [];
  return {
    version: EVENT_REGISTRATION_VERSION,
    answers: normalizeStoredAnswers(registration.answers),
    attendees
  };
}

function normalizeQuestion(rawQuestion, index) {
  if (!rawQuestion || typeof rawQuestion !== 'object' || Array.isArray(rawQuestion)) {
    return { ok: false, errors: [issue(
      'registration_question_invalid',
      'Each RSVP question must be an object.',
      { questionIndex: index }
    )] };
  }

  const errors = [];
  const id = normalizeString(rawQuestion.id).toLowerCase();
  const type = normalizeQuestionType(rawQuestion.type);
  const scope = normalizeQuestionScope(rawQuestion.scope);
  const label = boundedText(rawQuestion.label, EVENT_REGISTRATION_MAX_LABEL_LENGTH);

  if (!QUESTION_ID_PATTERN.test(id)) {
    errors.push(issue(
      'registration_question_id_invalid',
      'RSVP question IDs must use lowercase letters, numbers, dashes, or underscores.',
      { questionIndex: index }
    ));
  }
  if (!QUESTION_TYPES.has(type)) {
    errors.push(issue(
      'registration_question_type_invalid',
      'RSVP question type is not supported.',
      { questionId: id, questionIndex: index }
    ));
  }
  if (!QUESTION_SCOPES.has(scope)) {
    errors.push(issue(
      'registration_question_scope_invalid',
      'RSVP question scope must be party or attendee.',
      { questionId: id, questionIndex: index }
    ));
  }
  if (!label) {
    errors.push(issue(
      'registration_question_label_required',
      'RSVP questions require a label.',
      { questionId: id, questionIndex: index }
    ));
  }

  const options = normalizeQuestionOptions(rawQuestion.options, id, errors);
  if ((type === 'single_select' || type === 'multi_select') && options.length < 2) {
    errors.push(issue(
      'registration_question_options_required',
      'RSVP choice questions require at least two unique options.',
      { questionId: id, questionIndex: index }
    ));
  }

  const requestedMaxLength = Number(rawQuestion.max_length ?? rawQuestion.maxLength);
  const defaultMaxLength = type === 'textarea' ? 1000 : 160;
  const maxLength = Number.isInteger(requestedMaxLength) && requestedMaxLength > 0
    ? Math.min(requestedMaxLength, EVENT_REGISTRATION_MAX_TEXT_LENGTH)
    : defaultMaxLength;

  return errors.length > 0 ? { ok: false, errors } : {
    ok: true,
    question: {
      id,
      type,
      scope,
      label,
      required: rawQuestion.required === true,
      maxLength,
      options
    }
  };
}

function normalizeQuestionOptions(rawOptions, questionId, errors) {
  if (!Array.isArray(rawOptions)) return [];
  const options = [];
  const seen = new Set();
  rawOptions.slice(0, 20).forEach((rawOption, optionIndex) => {
    const value = boundedText(
      rawOption && typeof rawOption === 'object' ? rawOption.value : rawOption,
      EVENT_REGISTRATION_MAX_OPTION_LENGTH
    );
    const label = boundedText(
      rawOption && typeof rawOption === 'object' ? (rawOption.label ?? rawOption.value) : rawOption,
      EVENT_REGISTRATION_MAX_OPTION_LENGTH
    );
    if (!value || !label || seen.has(value)) {
      errors.push(issue(
        'registration_question_option_invalid',
        'RSVP question options must have unique non-empty values and labels.',
        { questionId, optionIndex }
      ));
      return;
    }
    seen.add(value);
    options.push({ value, label });
  });
  return options;
}

function normalizeAnswers(rawAnswers, questions, errors, context = {}) {
  const source = rawAnswers && typeof rawAnswers === 'object' && !Array.isArray(rawAnswers)
    ? rawAnswers
    : {};
  return questions.map((question) => {
    const normalized = normalizeAnswerValue(source[question.id], question);
    if (!normalized.valid) {
      errors.push(issue(
        normalized.code,
        normalized.message,
        { questionId: question.id, ...context }
      ));
    }
    return {
      id: question.id,
      label: question.label,
      type: question.type,
      scope: question.scope,
      value: normalized.value,
      ...(normalized.displayValue !== undefined ? { displayValue: normalized.displayValue } : {})
    };
  });
}

function normalizeAnswerValue(rawValue, question) {
  if (question.type === 'checkbox') {
    const value = rawValue === true || String(rawValue || '').trim().toLowerCase() === 'true';
    if (question.required && !value) {
      return { valid: false, value, code: 'registration_answer_required', message: `Answer “${question.label}” to continue.` };
    }
    return { valid: true, value };
  }

  if (question.type === 'multi_select') {
    const requested = Array.isArray(rawValue) ? rawValue.map(normalizeString).filter(Boolean) : [];
    const allowed = new Set(question.options.map((option) => option.value));
    const value = Array.from(new Set(requested.filter((entry) => allowed.has(entry))));
    if (requested.some((entry) => !allowed.has(entry))) {
      return { valid: false, value, code: 'registration_answer_invalid', message: `Choose valid options for “${question.label}”.` };
    }
    if (question.required && value.length === 0) {
      return { valid: false, value, code: 'registration_answer_required', message: `Answer “${question.label}” to continue.` };
    }
    const labelsByValue = new Map(question.options.map((option) => [option.value, option.label]));
    return { valid: true, value, displayValue: value.map((entry) => labelsByValue.get(entry) || entry) };
  }

  const value = boundedText(rawValue, question.maxLength);
  if (question.type === 'single_select') {
    const allowed = new Set(question.options.map((option) => option.value));
    if (value && !allowed.has(value)) {
      return { valid: false, value: '', code: 'registration_answer_invalid', message: `Choose a valid option for “${question.label}”.` };
    }
    const selectedOption = question.options.find((option) => option.value === value);
    if (selectedOption) {
      return { valid: true, value, displayValue: selectedOption.label };
    }
  }
  if (question.required && !value) {
    return { valid: false, value, code: 'registration_answer_required', message: `Answer “${question.label}” to continue.` };
  }
  return { valid: true, value };
}

function normalizeStoredAnswers(answers) {
  if (!Array.isArray(answers)) return [];
  return answers.slice(0, EVENT_REGISTRATION_MAX_QUESTIONS).map((answer) => {
    const displayValue = Array.isArray(answer?.displayValue)
      ? answer.displayValue.slice(0, 20).map((value) => boundedText(value, EVENT_REGISTRATION_MAX_OPTION_LENGTH)).filter(Boolean)
      : boundedText(answer?.displayValue, EVENT_REGISTRATION_MAX_OPTION_LENGTH);
    return {
      id: normalizeString(answer?.id).slice(0, 64),
      label: boundedText(answer?.label, EVENT_REGISTRATION_MAX_LABEL_LENGTH),
      type: normalizeQuestionType(answer?.type),
      scope: normalizeQuestionScope(answer?.scope),
      value: Array.isArray(answer?.value)
        ? answer.value.slice(0, 20).map((value) => boundedText(value, EVENT_REGISTRATION_MAX_OPTION_LENGTH)).filter(Boolean)
        : (typeof answer?.value === 'boolean' ? answer.value : boundedText(answer?.value, EVENT_REGISTRATION_MAX_TEXT_LENGTH)),
      ...(Array.isArray(displayValue) ? (displayValue.length > 0 ? { displayValue } : {}) : (displayValue ? { displayValue } : {}))
    };
  }).filter((answer) => answer.id);
}

function normalizeQuestionType(value) {
  const type = normalizeString(value).toLowerCase().replace(/-/g, '_');
  if (type === 'select' || type === 'radio' || type === 'single') return 'single_select';
  if (type === 'multiselect' || type === 'multiple' || type === 'checkboxes') return 'multi_select';
  if (type === 'long_text' || type === 'longtext') return 'textarea';
  return type || 'text';
}

function normalizeQuestionScope(value) {
  const scope = normalizeString(value).toLowerCase().replace(/-/g, '_');
  if (scope === 'order' || scope === 'group' || scope === 'registration') return 'party';
  return scope || 'party';
}

function normalizeDateTime(value, field, errors) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    errors.push(issue(
      'registration_datetime_invalid',
      `RSVP registration ${field} date must be a valid timestamp.`,
      { field }
    ));
    return '';
  }
  return new Date(parsed).toISOString();
}

function normalizePartySize(value, errors) {
  if (value === undefined || value === null || String(value).trim() === '') return EVENT_REGISTRATION_MAX_PARTY_SIZE;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > EVENT_REGISTRATION_MAX_PARTY_SIZE) {
    errors.push(issue(
      'registration_party_size_invalid',
      `RSVP maximum party size must be between 1 and ${EVENT_REGISTRATION_MAX_PARTY_SIZE}.`
    ));
    return EVENT_REGISTRATION_MAX_PARTY_SIZE;
  }
  return parsed;
}

function normalizePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeBoolean(value, fallback) {
  if (value === true || value === false) return value;
  if (String(value).trim().toLowerCase() === 'true') return true;
  if (String(value).trim().toLowerCase() === 'false') return false;
  return fallback;
}

function boundedText(value, maxLength) {
  return normalizeString(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, maxLength);
}

function normalizeString(value) {
  return String(value ?? '').trim();
}

function issue(code, message, details = {}) {
  return { code, message, ...details };
}
