const express = require('express');
const router = express.Router();
const usersCtrl = require('../../controllers/api/users');
const ensureLoggedIn = require('../../config/ensureLoggedIn');
const { authLimiter } = require('../../middleware/rateLimit');

// Strict rate limit on the unauthenticated auth endpoints (credential brute force).
router.post('/', authLimiter, usersCtrl.create);
router.post('/login', authLimiter, usersCtrl.login);
router.get('/me', ensureLoggedIn, usersCtrl.me);
router.put('/me', ensureLoggedIn, usersCtrl.updateMe);
router.get('/check-token', ensureLoggedIn, usersCtrl.checkToken);
router.get('/level', ensureLoggedIn, usersCtrl.getLevelSummary);
router.get('/points/history', ensureLoggedIn, usersCtrl.getPointHistory);
router.get('/event-types', ensureLoggedIn, usersCtrl.getEventTypes);
router.put('/event-types', ensureLoggedIn, usersCtrl.updateEventTypes);

module.exports = router;
