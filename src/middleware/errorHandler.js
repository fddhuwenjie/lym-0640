function errorHandler(err, req, res, next) {
  console.error('Error:', err.message);
  console.error(err.stack);

  const statusCode = err.statusCode || 400;
  res.status(statusCode).json({
    success: false,
    error: err.message || '服务器内部错误',
    code: statusCode,
  });
}

function notFoundHandler(req, res, next) {
  res.status(404).json({
    success: false,
    error: '接口不存在',
    code: 404,
  });
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler,
};
