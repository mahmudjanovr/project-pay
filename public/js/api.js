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
    let userMessage = '';

    if (status === 409) {
      if (data && typeof data === 'object' && data.message) {
        if (data.message.includes('assigned students')) {
          userMessage = 'Ushbu guruhda o\'quvchilar mavjud bo\'lganligi sababli uni o\'chirib bo\'lmaydi.';
        } else if (data.message.includes('already exists')) {
          userMessage = 'Ushbu nomdagi guruh allaqachon mavjud.';
        } else if (data.message.includes('payment history')) {
          userMessage = 'Ushbu o\'quvchida to\'lovlar tarixi mavjud bo\'lganligi sababli uni o\'chirib bo\'lmaydi.';
        } else {
          userMessage = data.message;
        }
      } else {
        userMessage = 'Amalni bajarishda ziddiyat yuz berdi.';
      }
    } else if (data && typeof data === 'object' && data.message) {
      userMessage = data.message;
    } else if (status === 400) {
      userMessage = 'Kiritilgan ma\'lumotlar yaroqsiz.';
    } else if (status === 404) {
      userMessage = 'So\'ralgan ma\'lumot topilmadi.';
    } else if (status === 413) {
      userMessage = 'Yuborilgan ma\'lumot hajmi juda katta.';
    } else if (status >= 500) {
      userMessage = 'Serverda texnik xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko\'ring.';
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

export async function createStudent({ full_name, monthly_fee, group_id = null }) {
  const payload = { full_name, monthly_fee };
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

export async function fetchMonthlyDebtors(month) {
  const query = encodeURIComponent(month);
  return request(`/api/reports/debtors?month=${query}`);
}

