const allowRoles = (...allowedRoles) => {
  return (req, res, next) => {
    const effectiveRoles = [req.groupMembership?.role, req.user?.role].filter(Boolean);

    if (!effectiveRoles.length) {
      return res.status(403).json({
        message: "Access denied"
      });
    }

    if (!effectiveRoles.some((role) => allowedRoles.includes(role))) {
      return res.status(403).json({
        message: "You do not have permission to perform this action"
      });
    }

    next();
  };
};

module.exports = allowRoles;
