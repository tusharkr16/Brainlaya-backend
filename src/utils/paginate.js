// Shared list-endpoint pagination: ?page=1&limit=20, capped so nobody can
// request the whole collection in one shot.
function parsePagination(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

function paginationMeta(total, page, limit) {
  return { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

module.exports = { parsePagination, paginationMeta };
