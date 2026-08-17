export type PreparedSql = {
  readonly query: string;
  readonly params: readonly (number | string)[];
};

type MergeAccountInput = {
  readonly consumeToken: string;
  readonly deviceId: string;
  readonly email: string;
  readonly userId: string;
  readonly userOwnerId: string;
};

const CLAIM = `EXISTS (SELECT 1 FROM email_verification_codes WHERE consume_token = ?)
  AND EXISTS (SELECT 1 FROM users WHERE id = ? AND email = ?)`;

export function accountMergeStatements(input: MergeAccountInput): readonly PreparedSql[] {
  const claimParams = (): readonly string[] => [input.consumeToken, input.userId, input.email];
  return [
    {
      query: `DELETE FROM favorites
        WHERE owner_id = ?
          AND url IN (SELECT url FROM favorites WHERE owner_id = ?)
          AND ${CLAIM}`,
      params: [input.deviceId, input.userOwnerId, ...claimParams()],
    },
    {
      query: `UPDATE favorites SET owner_id = ? WHERE owner_id = ? AND ${CLAIM}`,
      params: [input.userOwnerId, input.deviceId, ...claimParams()],
    },
    {
      query: `WITH affected AS (
          SELECT DISTINCT article_id, paragraph_index
          FROM highlight_paragraphs
          WHERE owner_id = ?
          UNION
          SELECT DISTINCT article_id, paragraph_index
          FROM highlights
          WHERE owner_id = ?
            AND EXISTS (
              SELECT 1 FROM highlight_paragraphs
              WHERE highlight_paragraphs.owner_id IN (?, ?)
                AND highlight_paragraphs.article_id = highlights.article_id
                AND highlight_paragraphs.paragraph_index = highlights.paragraph_index
            )
        ),
        legacy_source AS (
          SELECT owner_id, article_id, paragraph_index, text, note, styles,
            start_offset, end_offset, created_at, id
          FROM highlights
          WHERE owner_id IN (?, ?)
            AND json_valid(styles)
            AND EXISTS (
              SELECT 1 FROM affected
              WHERE affected.article_id = highlights.article_id
                AND affected.paragraph_index = highlights.paragraph_index
            )
          ORDER BY owner_id, article_id, paragraph_index, created_at, id
        ),
        legacy_candidates AS (
          SELECT owner_id, article_id, paragraph_index, max(created_at) AS content_at,
            json_group_array(json_object(
              'text', text, 'note', note, 'styles', json(styles),
              'start', start_offset, 'end', end_offset
            )) AS spans,
            0 AS version,
            0 AS is_versioned
          FROM legacy_source
          GROUP BY owner_id, article_id, paragraph_index
        ),
        candidates AS (
          SELECT owner_id, article_id, paragraph_index, updated_at AS content_at,
            spans, version, 1 AS is_versioned
          FROM highlight_paragraphs
          WHERE owner_id IN (?, ?)
            AND EXISTS (
              SELECT 1 FROM affected
              WHERE affected.article_id = highlight_paragraphs.article_id
                AND affected.paragraph_index = highlight_paragraphs.paragraph_index
            )
          UNION ALL
          SELECT owner_id, article_id, paragraph_index, content_at,
            spans, version, is_versioned
          FROM legacy_candidates
        ),
        ranked AS (
          SELECT *, row_number() OVER (
            PARTITION BY article_id, paragraph_index
            ORDER BY content_at DESC, owner_id = ? DESC, is_versioned DESC
          ) AS rank
          FROM candidates
        ),
        versions AS (
          SELECT article_id, paragraph_index, max(version) AS version
          FROM candidates
          GROUP BY article_id, paragraph_index
        )
        INSERT INTO highlight_paragraphs
          (owner_id, article_id, paragraph_index, version, spans, updated_at)
        SELECT ?, ranked.article_id, ranked.paragraph_index, versions.version + 1,
          ranked.spans, ranked.content_at
        FROM ranked
        INNER JOIN versions USING (article_id, paragraph_index)
        WHERE ranked.rank = 1 AND ${CLAIM}
        ON CONFLICT(owner_id, article_id, paragraph_index) DO UPDATE SET
          version = max(highlight_paragraphs.version + 1, excluded.version),
          spans = excluded.spans,
          updated_at = excluded.updated_at`,
      params: [
        input.deviceId, input.deviceId, input.userOwnerId, input.deviceId,
        input.userOwnerId, input.deviceId, input.userOwnerId, input.deviceId,
        input.userOwnerId, input.userOwnerId,
        ...claimParams(),
      ],
    },
    {
      query: `DELETE FROM highlight_paragraphs WHERE owner_id = ? AND ${CLAIM}`,
      params: [input.deviceId, ...claimParams()],
    },
    {
      query: `INSERT INTO practice (owner_id, date, correct, total)
        SELECT ?, date, correct, total FROM practice
        WHERE owner_id = ? AND ${CLAIM}
        ON CONFLICT(owner_id, date) DO NOTHING`,
      params: [input.userOwnerId, input.deviceId, ...claimParams()],
    },
    {
      query: `DELETE FROM practice WHERE owner_id = ? AND ${CLAIM}`,
      params: [input.deviceId, ...claimParams()],
    },
    {
      query: `INSERT INTO wrong_questions (id, owner_id, date, question, options, answer, chosen, analysis, created_at)
        SELECT id, ?, date, question, options, answer, chosen, analysis, created_at
        FROM wrong_questions WHERE owner_id = ? AND ${CLAIM}
        ON CONFLICT(id) DO NOTHING`,
      params: [input.userOwnerId, input.deviceId, ...claimParams()],
    },
    {
      query: `DELETE FROM wrong_questions WHERE owner_id = ? AND ${CLAIM}`,
      params: [input.deviceId, ...claimParams()],
    },
    {
      query: `DELETE FROM highlights
        WHERE owner_id IN (?, ?)
          AND json_valid(styles)
          AND EXISTS (
            SELECT 1 FROM highlight_paragraphs
            WHERE highlight_paragraphs.owner_id = ?
              AND highlight_paragraphs.article_id = highlights.article_id
              AND highlight_paragraphs.paragraph_index = highlights.paragraph_index
          )
          AND ${CLAIM}`,
      params: [input.userOwnerId, input.deviceId, input.userOwnerId, ...claimParams()],
    },
    {
      query: `UPDATE highlights SET owner_id = ? WHERE owner_id = ? AND ${CLAIM}`,
      params: [input.userOwnerId, input.deviceId, ...claimParams()],
    },
  ];
}
