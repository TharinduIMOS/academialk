import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { INITIAL_COURSES, INITIAL_PAYMENTS, INITIAL_USERS } from './src/data/mockData.js';
import { Course, PaymentTransaction, User, ZoomSession, VideoRecording } from './src/types.js';

const DATA_FILE = path.join(process.cwd(), 'data_store.json');

function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, 'utf-8');
      const data = JSON.parse(content);
      if (data && Array.isArray(data.courses)) {
        return {
          users: data.users || [...INITIAL_USERS],
          courses: data.courses || [...INITIAL_COURSES],
          payments: data.payments || [...INITIAL_PAYMENTS],
        };
      }
    }
  } catch (err) {
    console.error('Error reading data_store.json:', err);
  }
  return {
    users: [...INITIAL_USERS],
    courses: [...INITIAL_COURSES],
    payments: [...INITIAL_PAYMENTS],
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Persistent Store (Loaded from disk)
  const store = loadStore();
  let users: User[] = store.users;
  // Filter out any obsolete course IDs so only physics 2026 and manually added ones stay
  const obsoleteCourseIds = ['biology', 'chemistry', 'combined-maths', 'physics-2027', 'biology-2027', 'chemistry-2027', 'combined-maths-2027'];
  let courses: Course[] = store.courses.filter(c => !obsoleteCourseIds.includes(c.id));
  if (courses.length === 0) {
    courses = [...INITIAL_COURSES];
  }
  let payments: PaymentTransaction[] = store.payments;

  // Guarantee at least one admin account exists
  if (!users.some(u => u.role === 'admin')) {
    users.unshift({
      id: 'usr-admin-1',
      name: 'Platform Admin',
      email: 'admin@lms.edu',
      role: 'admin',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      phone: '+1 (555) 019-2831',
      bio: 'Lead Academic Director & Master Administrator.',
      enrolledCourseIds: [],
      enrolledMonthKeys: [],
      createdAt: new Date().toISOString(),
    });
  }

  function saveData() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify({ users, courses, payments }, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to write persistent data_store.json:', err);
    }
  }

  // Save cleaned state to store immediately
  saveData();

  // Helper function to find user
  const findUserByEmail = (email: string) => users.find(u => u.email.toLowerCase() === email.toLowerCase());

  // ================= API ROUTES ================= //

  // 0. Restore / Reset Admin Account
  app.post('/api/auth/reset-admin', (req, res) => {
    let adminUser = users.find(u => u.email === 'admin@lms.edu' || u.role === 'admin');
    if (!adminUser) {
      adminUser = {
        id: `usr-admin-${Date.now()}`,
        name: 'Platform Admin',
        email: 'admin@lms.edu',
        role: 'admin',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        phone: '+1 (555) 019-2831',
        bio: 'Lead Academic Director & Master Administrator.',
        enrolledCourseIds: [],
        enrolledMonthKeys: [],
        createdAt: new Date().toISOString(),
      };
      users.unshift(adminUser);
    } else {
      adminUser.role = 'admin';
    }
    saveData();
    return res.json({ message: 'Admin account restored successfully', user: adminUser });
  });

  // 1. Auth & Profiles
  app.post('/api/auth/login', (req, res) => {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = findUserByEmail(email);

    if (!user) {
      return res.status(400).json({ 
        error: 'Account not found. Only registered users can log in. Please register first.' 
      });
    }

    return res.json({ user, token: `token-${user.id}` });
  });

  app.post('/api/auth/register', (req, res) => {
    const { name, email, phone, bio } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    if (findUserByEmail(email)) {
      return res.status(400).json({ error: 'An account with this email already exists. Please log in.' });
    }

    // New registrations are strictly created as students
    const user: User = {
      id: `usr-${Date.now()}`,
      name: name.trim(),
      email: email.trim(),
      role: 'student',
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
      phone: phone ? phone.trim() : '',
      bio: bio ? bio.trim() : '',
      enrolledCourseIds: [],
      enrolledMonthKeys: [],
      createdAt: new Date().toISOString(),
    };

    users.push(user);
    saveData();

    return res.json({ user, token: `token-${user.id}` });
  });

  app.put('/api/users/profile', (req, res) => {
    const { userId, name, avatar, phone, bio } = req.body;
    const userIndex = users.findIndex(u => u.id === userId);

    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    users[userIndex] = {
      ...users[userIndex],
      name: name ?? users[userIndex].name,
      avatar: avatar ?? users[userIndex].avatar,
      phone: phone ?? users[userIndex].phone,
      bio: bio ?? users[userIndex].bio,
    };

    saveData();
    return res.json({ user: users[userIndex] });
  });

  app.get('/api/users', (req, res) => {
    return res.json({ users });
  });

  app.post('/api/admin/users/create', (req, res) => {
    const { name, email, role, phone, bio } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    if (findUserByEmail(email)) {
      return res.status(400).json({ error: 'An account with this email address already exists' });
    }

    const newAccount: User = {
      id: `usr-${Date.now()}`,
      name,
      email,
      role: role === 'admin' ? 'admin' : 'student',
      avatar: role === 'admin'
        ? 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150&auto=format&fit=crop&q=80'
        : 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      phone: phone || '',
      bio: bio || (role === 'admin' ? 'Administrator Account' : 'Student Account'),
      enrolledCourseIds: [],
      enrolledMonthKeys: [],
      createdAt: new Date().toISOString(),
    };

    users.push(newAccount);
    saveData();
    return res.status(201).json({ user: newAccount, users });
  });

  app.put('/api/admin/users/:id', (req, res) => {
    const { id } = req.params;
    const userIndex = users.findIndex(u => u.id === id);

    if (userIndex === -1) {
      return res.status(404).json({ error: 'User account not found' });
    }

    const { name, email, role, phone, bio, enrolledMonthKeys, enrolledCourseIds } = req.body;

    users[userIndex] = {
      ...users[userIndex],
      name: name ?? users[userIndex].name,
      email: email ?? users[userIndex].email,
      role: role ?? users[userIndex].role,
      phone: phone ?? users[userIndex].phone,
      bio: bio ?? users[userIndex].bio,
      enrolledMonthKeys: enrolledMonthKeys ?? users[userIndex].enrolledMonthKeys,
      enrolledCourseIds: enrolledCourseIds ?? users[userIndex].enrolledCourseIds,
    };

    saveData();
    return res.json({ user: users[userIndex], users });
  });

  app.delete('/api/admin/users/:id', (req, res) => {
    const { id } = req.params;
    const userIndex = users.findIndex(u => u.id === id);

    if (userIndex === -1) {
      return res.status(404).json({ error: 'User account not found' });
    }

    const deletedUser = users[userIndex];
    users = users.filter(u => u.id !== id);

    saveData();
    return res.json({ success: true, deletedUser, users });
  });

  // 2. Course Catalog & Details
  app.get('/api/courses', (req, res) => {
    return res.json({ courses });
  });

  app.post('/api/courses', (req, res) => {
    const courseData = req.body;
    const newCourse: Course = {
      id: `course-${Date.now()}`,
      title: courseData.title || 'Untitled Course',
      category: courseData.category || 'General',
      batch: courseData.batch || '2026 A/L',
      description: courseData.description || '',
      instructor: courseData.instructor || 'Lead Faculty',
      instructorAvatar: courseData.instructorAvatar || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      instructorTitle: courseData.instructorTitle || 'Senior Subject Master & Lecturer',
      instructorBio: courseData.instructorBio || 'Experienced academic instructor.',
      price: Number(courseData.price) || 0,
      originalPrice: courseData.originalPrice ? Number(courseData.originalPrice) : undefined,
      availableMonths: courseData.availableMonths || ['July 2026', 'August 2026', 'September 2026', 'October 2026', 'November 2026', 'December 2026'],
      image: courseData.image || 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800&auto=format&fit=crop&q=80',
      rating: 5.0,
      reviewsCount: 1,
      duration: courseData.duration || '6 Weeks',
      level: courseData.level || 'All Levels',
      scheduleText: courseData.scheduleText || 'Weekly Live Sessions',
      zoomSessions: courseData.zoomSessions || [],
      recordings: courseData.recordings || [],
      tags: courseData.tags || ['Online'],
    };

    courses.unshift(newCourse);
    saveData();
    return res.status(201).json({ course: newCourse });
  });

  app.put('/api/courses/:id', (req, res) => {
    const { id } = req.params;
    const index = courses.findIndex(c => c.id === id);

    if (index === -1) {
      return res.status(404).json({ error: 'Course not found' });
    }

    courses[index] = {
      ...courses[index],
      ...req.body,
    };

    saveData();
    return res.json({ course: courses[index] });
  });

  app.delete('/api/courses/:id', (req, res) => {
    const { id } = req.params;
    courses = courses.filter(c => c.id !== id);
    saveData();
    return res.json({ success: true, message: 'Course deleted' });
  });

  // 3. Zoom Sessions Management (Admin)
  app.post('/api/courses/:id/zoom-sessions', (req, res) => {
    const { id } = req.params;
    const courseIndex = courses.findIndex(c => c.id === id);

    if (courseIndex === -1) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const { title, scheduledAt, durationMinutes, zoomUrl, meetingId, passcode, hostName, status, month } = req.body;

    const newZoomSession: ZoomSession = {
      id: `zoom-${Date.now()}`,
      courseId: id,
      month: month || 'July 2026',
      title: title || 'Live Class Session',
      scheduledAt: scheduledAt || new Date().toISOString(),
      durationMinutes: Number(durationMinutes) || 60,
      zoomUrl: zoomUrl || 'https://zoom.us/j/1234567890',
      meetingId: meetingId || '123 456 7890',
      passcode: passcode || '123456',
      status: status || 'upcoming',
      hostName: hostName || courses[courseIndex].instructor,
    };

    courses[courseIndex].zoomSessions.push(newZoomSession);
    saveData();
    return res.status(201).json({ course: courses[courseIndex], session: newZoomSession });
  });

  app.put('/api/courses/:id/zoom-sessions/:sessionId', (req, res) => {
    const { id, sessionId } = req.params;
    const courseIndex = courses.findIndex(c => c.id === id);

    if (courseIndex === -1) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const sessionIndex = courses[courseIndex].zoomSessions.findIndex(s => s.id === sessionId);
    if (sessionIndex === -1) {
      return res.status(404).json({ error: 'Zoom session not found' });
    }

    courses[courseIndex].zoomSessions[sessionIndex] = {
      ...courses[courseIndex].zoomSessions[sessionIndex],
      ...req.body,
    };

    saveData();
    return res.json({ course: courses[courseIndex], session: courses[courseIndex].zoomSessions[sessionIndex] });
  });

  app.delete('/api/courses/:id/zoom-sessions/:sessionId', (req, res) => {
    const { id, sessionId } = req.params;
    const courseIndex = courses.findIndex(c => c.id === id);

    if (courseIndex !== -1) {
      courses[courseIndex].zoomSessions = courses[courseIndex].zoomSessions.filter(s => s.id !== sessionId);
      saveData();
    }

    return res.json({ success: true });
  });

  // 4. Video Recordings Management (Admin)
  app.post('/api/courses/:id/recordings', (req, res) => {
    const { id } = req.params;
    const courseIndex = courses.findIndex(c => c.id === id);

    if (courseIndex === -1) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const { title, videoUrl, duration, chapter, description, resources, month } = req.body;

    const newRecording: VideoRecording = {
      id: `rec-${Date.now()}`,
      courseId: id,
      month: month || 'July 2026',
      title: title || 'Lecture Recording',
      videoUrl: videoUrl || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      duration: duration || '45 mins',
      chapter: chapter || 'Chapter 1',
      description: description || '',
      resources: resources || [],
    };

    courses[courseIndex].recordings.push(newRecording);
    saveData();
    return res.status(201).json({ course: courses[courseIndex], recording: newRecording });
  });

  app.put('/api/courses/:id/recordings/:recId', (req, res) => {
    const { id, recId } = req.params;
    const courseIndex = courses.findIndex(c => c.id === id);

    if (courseIndex === -1) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const recIndex = courses[courseIndex].recordings.findIndex(r => r.id === recId);
    if (recIndex === -1) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    courses[courseIndex].recordings[recIndex] = {
      ...courses[courseIndex].recordings[recIndex],
      ...req.body,
    };

    saveData();
    return res.json({ course: courses[courseIndex], recording: courses[courseIndex].recordings[recIndex] });
  });

  app.delete('/api/courses/:id/recordings/:recId', (req, res) => {
    const { id, recId } = req.params;
    const courseIndex = courses.findIndex(c => c.id === id);

    if (courseIndex !== -1) {
      courses[courseIndex].recordings = courses[courseIndex].recordings.filter(r => r.id !== recId);
      saveData();
    }

    return res.json({ success: true });
  });

  // 5. Payment & Enrollment Management
  app.get('/api/payments', (req, res) => {
    const { userId } = req.query;
    if (userId) {
      return res.json({ payments: payments.filter(p => p.userId === userId) });
    }
    return res.json({ payments });
  });

  app.post('/api/payments/purchase', (req, res) => {
    const { userId, courseId, month, paymentMethod, receiptUrl, note } = req.body;

    const user = users.find(u => u.id === userId);
    const course = courses.find(c => c.id === courseId);

    if (!user || !course) {
      return res.status(404).json({ error: 'User or course not found' });
    }

    const selectedMonth = month || 'July 2026';
    const monthKey = `${courseId}_${selectedMonth}`;

    if (!user.enrolledMonthKeys) {
      user.enrolledMonthKeys = [];
    }

    // Check if already enrolled in this specific month
    const existingApprovedMonth = user.enrolledMonthKeys.includes(monthKey);
    if (existingApprovedMonth) {
      return res.status(400).json({ error: `You are already enrolled in ${course.title} for ${selectedMonth}` });
    }

    const isCardInstant = paymentMethod === 'card' || paymentMethod === 'paypal';
    const status = isCardInstant ? 'approved' : 'pending';

    const newPayment: PaymentTransaction = {
      id: `pay-${Date.now()}`,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      userAvatar: user.avatar,
      courseId: course.id,
      month: selectedMonth,
      courseTitle: `${course.title} (${selectedMonth})`,
      coursePrice: course.price,
      amount: course.price,
      paymentMethod,
      receiptUrl: receiptUrl || (paymentMethod === 'bank_transfer' ? 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600&auto=format&fit=crop&q=80' : undefined),
      referenceCode: `TXN-${paymentMethod.toUpperCase()}-${Math.floor(100000 + Math.random() * 900000)}`,
      note,
      status,
      createdAt: new Date().toISOString(),
      reviewedAt: isCardInstant ? new Date().toISOString() : undefined,
    };

    payments.unshift(newPayment);

    // If card or instant approval, unlock month immediately
    if (status === 'approved') {
      if (!user.enrolledCourseIds.includes(courseId)) {
        user.enrolledCourseIds.push(courseId);
      }
      if (!user.enrolledMonthKeys.includes(monthKey)) {
        user.enrolledMonthKeys.push(monthKey);
      }
    }

    saveData();
    return res.status(201).json({ payment: newPayment, user });
  });

  // Admin Approve Payment
  app.put('/api/payments/:id/approve', (req, res) => {
    const { id } = req.params;
    const paymentIndex = payments.findIndex(p => p.id === id);

    if (paymentIndex === -1) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const payment = payments[paymentIndex];
    payment.status = 'approved';
    payment.reviewedAt = new Date().toISOString();

    // Unlock month for student
    const user = users.find(u => u.id === payment.userId);
    if (user) {
      if (!user.enrolledCourseIds.includes(payment.courseId)) {
        user.enrolledCourseIds.push(payment.courseId);
      }
      if (!user.enrolledMonthKeys) {
        user.enrolledMonthKeys = [];
      }
      const monthKey = `${payment.courseId}_${payment.month || 'July 2026'}`;
      if (!user.enrolledMonthKeys.includes(monthKey)) {
        user.enrolledMonthKeys.push(monthKey);
      }
    }

    saveData();
    return res.json({ payment, user });
  });

  // Admin Reject Payment
  app.put('/api/payments/:id/reject', (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    const paymentIndex = payments.findIndex(p => p.id === id);

    if (paymentIndex === -1) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const payment = payments[paymentIndex];
    payment.status = 'rejected';
    payment.reviewedAt = new Date().toISOString();
    payment.rejectionReason = reason || 'Payment receipt could not be verified.';

    saveData();
    return res.json({ payment });
  });

  // 6. Admin Stats Overview
  app.get('/api/stats', (req, res) => {
    const totalStudents = users.filter(u => u.role === 'student').length;
    const totalRevenue = payments
      .filter(p => p.status === 'approved')
      .reduce((sum, p) => sum + p.amount, 0);
    const pendingApprovals = payments.filter(p => p.status === 'pending').length;
    const activeCourses = courses.length;
    const upcomingZoomClasses = courses.reduce(
      (count, c) => count + c.zoomSessions.filter(s => s.status === 'upcoming' || s.status === 'live').length,
      0
    );

    return res.json({
      totalStudents,
      totalRevenue,
      pendingApprovals,
      activeCourses,
      upcomingZoomClasses,
    });
  });

  // Vite middleware for development vs static serve for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LMS Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
