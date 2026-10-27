/**
 * Reusable same-origin API client for Project Pay.
 * Formats request payloads and normalizes API error responses into clear Uzbek messages.
 */

export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {any} [data]
   */
  constructor(message, status, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Executes a JSON fetch request and handles errors defensively.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
async function request(url, options = {}) {
  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {})
    }
  };

  let response;
  try {
    response = await fetch(url, config);
  } catch (networkErr) {
    if (networkErr && networkErr.name === 'AbortError') {
      throw networkErr;
    }
    throw new ApiError(
      'Serverga ulanishda xatolik yuz berdi. Internet aloqasini tekshiring.',
      0,
      networkErr
    );
  }

  // Parse response body safely
  let data = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    try {
      data = await response.text();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const status = response.status;
    const rawMessage = data && typeof data === 'object' && typeof data.message === 'string'
      ? data.message
      : '';
    let userMessage = '';

    if (status === 409) {
      if (rawMessage.includes('assigned students')) {
        userMessage = 'Ushbu guruhda o\'quvchilar mavjud bo\'lganligi sababli uni o\'chirib bo\'lmaydi.';
      } else if (rawMessage.includes('already exists')) {
        userMessage = 'Ushbu nomdagi guruh allaqachon mavjud.';
      } else if (rawMessage.includes('payment history')) {
        userMessage = 'Ushbu o\'quvchida to\'lovlar tarixi mavjud bo\'lganligi sababli uni o\'chirib bo\'lmaydi.';
      } else {
        userMessage = 'Amalni bajarishda ziddiyat yuz berdi.';
      }
    } else if (status === 404) {
      if (rawMessage.includes('Student with ID')) {
        userMessage = 'So\'ralgan o\'quvchi topilmadi.';
      } else if (rawMessage.includes('Group with ID')) {
        userMessage = 'So\'ralgan guruh topilmadi.';
      } else {
        userMessage = 'So\'ralgan ma\'lumot topilmadi.';
      }
    } else if (status === 413) {
      userMessage = 'Yuborilgan ma\'lumot hajmi juda katta.';
    } else if (status >= 500) {
      userMessage = 'Serverda texnik xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko\'ring.';
    } else if (status === 400) {
      const lower = rawMessage.toLowerCase();
      if (lower.includes('payment date') || lower.includes('calendar date')) {
        userMessage = 'To\'lov sanasi haqiqiy taqvim sanasi bo\'lishi shart (YYYY-MM-DD).';
      } else if (lower.includes('month') && !lower.includes('monthly')) {
        userMessage = 'Hisobot oyi YYYY-MM formatida bo\'lishi kerak.';
      } else if (lower.includes('student name') || lower.includes('full_name')) {
        userMessage = 'O\'quvchi F.I.SH. to\'g\'ri kiritilishi shart (1–200 belgi).';
      } else if (lower.includes('group name')) {
        userMessage = 'Guruh nomi to\'g\'ri kiritilishi shart (1–150 belgi).';
      } else if (lower.includes('phone')) {
        userMessage = 'Telefon raqami 50 ta belgidan oshmasligi kerak.';
      } else if (lower.includes('monthly fee') || lower.includes('monthly_fee')) {
        userMessage = 'Oylik to\'lov noldan kichik bo\'lmagan butun son bo\'lishi shart.';
      } else if (lower.includes('payment amount') || lower.includes('amount')) {
        userMessage = 'To\'lov summasi musbat butun son bo\'lishi shart.';
      } else if (lower.includes('malformed json')) {
        userMessage = 'Yuborilgan so\'rov formati yaroqsiz (JSON xatosi).';
      } else if (lower.includes('overflow') || lower.includes('safe integer')) {
        userMessage = 'Hisob-kitob summasi ruxsat etilgan maksimal chegaradan oshib ketdi.';
      } else {
        userMessage = 'Kiritilgan ma\'lumotlar yaroqsiz.';
      }
    } else {
      userMessage = `Xatolik yuz berdi (Status: ${status}).`;
    }

    throw new ApiError(userMessage, status, data);
  }

  return data;
}

// Student API Calls

export async function fetchStudents() {
  return request('/api/students');
}

export async function fetchStudent(id) {
  return request(`/api/students/${id}`);
}

export async function createStudent({ full_name, phone, monthly_fee, group_id = null }) {
  const payload = { full_name, monthly_fee };
  if (phone !== undefined) {
    payload.phone = phone;
  }
  if (group_id !== undefined) {
    payload.group_id = group_id;
  }
  return request('/api/students', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function updateStudent(id, fields) {
  return request(`/api/students/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields)
  });
}

export async function deleteStudent(id) {
  return request(`/api/students/${id}`, {
    method: 'DELETE'
  });
}

// Group API Calls

export async function fetchGroups() {
  return request('/api/groups');
}

export async function fetchGroup(id) {
  return request(`/api/groups/${id}`);
}

export async function fetchGroupStudents(id) {
  return request(`/api/groups/${id}/students`);
}

export async function createGroup({ name }) {
  return request('/api/groups', {
    method: 'POST',
    body: JSON.stringify({ name })
  });
}

export async function updateGroup(id, { name }) {
  return request(`/api/groups/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name })
  });
}

export async function deleteGroup(id) {
  return request(`/api/groups/${id}`, {
    method: 'DELETE'
  });
}

// Payment API Calls

export async function recordPayment({ student_id, amount, payment_date }) {
  return request('/api/payments', {
    method: 'POST',
    body: JSON.stringify({ student_id, amount, payment_date })
  });
}

export async function fetchStudentPayments(studentId) {
  return request(`/api/students/${studentId}/payments`);
}

// Report API Calls

export async function fetchMonthlyDebtors(month, options = {}) {
  const query = encodeURIComponent(month);
  return request(`/api/reports/debtors?month=${query}`, options);
}

export async function fetchAnnualReport(year, options = {}) {
  const query = encodeURIComponent(year);
  return request(`/api/reports/annual?year=${query}`, options);
}

