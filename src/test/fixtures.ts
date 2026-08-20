import type { Graph, Question, QuestionOption, Edge } from "../api/types";

/**
 * One graph payload with every shape the map has to draw.
 *
 * Built to match a real `GET versions/<id>/graph/` body rather than to be
 * convenient: an archived question that something still points at, an edge
 * across versions, an option guard on a question that does not offer it,
 * an end-of-flow edge and a question nothing routes to. If the server's
 * payload changes, these tests are where it should show up first.
 */

export const VERSION_ID = "11111111-1111-4111-8111-111111111111";
export const QUESTIONNAIRE_ID = "22222222-2222-4222-8222-222222222222";
export const Q1 = "aaaaaaaa-0000-4000-8000-000000000001";
export const Q2 = "aaaaaaaa-0000-4000-8000-000000000002";
export const Q3_ARCHIVED = "aaaaaaaa-0000-4000-8000-000000000003";
export const Q4_UNREACHABLE = "aaaaaaaa-0000-4000-8000-000000000004";
export const OPTION_YES = "bbbbbbbb-0000-4000-8000-000000000001";
export const OPTION_NO = "bbbbbbbb-0000-4000-8000-000000000002";
export const E_YES_TO_Q2 = "cccccccc-0000-4000-8000-000000000001";
export const E_NO_TO_END = "cccccccc-0000-4000-8000-000000000002";
export const E_Q2_TO_ARCHIVED = "cccccccc-0000-4000-8000-000000000003";
export const E_Q2_DEAD = "cccccccc-0000-4000-8000-000000000004";
export const E_Q4_TO_MISSING = "cccccccc-0000-4000-8000-000000000005";
export const FOREIGN_QUESTION = "dddddddd-0000-4000-8000-000000000009";

const option = (
  id: string,
  code: string,
  label: string,
  order: number,
): QuestionOption => ({ id, code, label, display_order: order });

const question = (
  overrides: Partial<Question> & Pick<Question, "id" | "code">,
): Question => ({
  prompt: `Prompt for ${overrides.code}`,
  answer_type: "scale",
  is_required: true,
  display_order: 1,
  section: null,
  archived_at: null,
  options: [],
  diagnostics: {
    is_entry: false,
    is_reachable: true,
    is_decision_point: false,
    is_terminal: false,
    destination_question_ids: [],
    uncovered_option_ids: [],
    dead_edge_ids: [],
    broken_edge_ids: [],
  },
  ...overrides,
});

const edge = (
  overrides: Pick<Edge, "id" | "from_question" | "priority"> & Partial<Edge>,
): Edge => ({
  from_option: null,
  to_question: null,
  ...overrides,
});

export function makeGraph(overrides: Partial<Graph> = {}): Graph {
  const graph: Graph = {
    version: {
      id: VERSION_ID,
      questionnaire: QUESTIONNAIRE_ID,
      questionnaire_name: "Risk profiling",
      questionnaire_spawned_from_version: null,
      name: "Risk profiling v3",
      label: "",
      number: 3,
      is_active: true,
      is_draft: false,
      routing_model: "graph",
      parent_version: null,
      published_at: "2026-08-01T09:00:00Z",
      published_by_email: "admin@example.com",
      is_stale: false,
      created: "2026-08-01T09:00:00Z",
      modified: "2026-08-01T09:00:00Z",
    },
    change_request: null,
    sections: [
      {
        id: "eeeeeeee-0000-4000-8000-000000000001",
        code: "intro",
        name: "Introduction",
        description: "",
        display_order: 1,
        live_question_count: 2,
      },
    ],
    questions: [
      question({
        id: Q1,
        code: "Q1",
        answer_type: "single_choice",
        display_order: 1,
        options: [
          option(OPTION_YES, "yes", "Yes", 0),
          option(OPTION_NO, "no", "No", 1),
        ],
        diagnostics: {
          is_entry: true,
          is_reachable: true,
          is_decision_point: true,
          is_terminal: true,
          destination_question_ids: [Q2],
          uncovered_option_ids: [],
          dead_edge_ids: [],
          broken_edge_ids: [],
        },
      }),
      question({
        id: Q2,
        code: "Q2",
        display_order: 2,
        diagnostics: {
          is_entry: false,
          is_reachable: true,
          is_decision_point: false,
          is_terminal: false,
          destination_question_ids: [],
          uncovered_option_ids: [],
          dead_edge_ids: [E_Q2_DEAD],
          broken_edge_ids: [E_Q2_TO_ARCHIVED],
        },
      }),
      // Archived, and drawn only because Q2 still points at it. Carries no
      // diagnostics at all -- the resolver never serves an archived
      // question, so it has no behaviour to describe.
      question({
        id: Q3_ARCHIVED,
        code: "Q3",
        display_order: 3,
        archived_at: "2026-07-14T11:00:00Z",
        diagnostics: null,
      }),
      question({
        id: Q4_UNREACHABLE,
        code: "Q4",
        display_order: 4,
        diagnostics: {
          is_entry: false,
          is_reachable: false,
          is_decision_point: false,
          is_terminal: false,
          destination_question_ids: [],
          uncovered_option_ids: [],
          dead_edge_ids: [],
          broken_edge_ids: [E_Q4_TO_MISSING],
        },
      }),
    ],
    edges: [
      edge({
        id: E_YES_TO_Q2,
        from_question: Q1,
        from_option: OPTION_YES,
        to_question: Q2,
        priority: 0,
      }),
      edge({
        id: E_NO_TO_END,
        from_question: Q1,
        from_option: OPTION_NO,
        to_question: null,
        priority: 1,
      }),
      edge({
        id: E_Q2_TO_ARCHIVED,
        from_question: Q2,
        to_question: Q3_ARCHIVED,
        priority: 0,
      }),
      // Guarded by an option Q2 does not offer -- Q1 owns it -- so the
      // guard can never match. This is what `dead_edge_ids` reports.
      edge({
        id: E_Q2_DEAD,
        from_question: Q2,
        from_option: OPTION_YES,
        to_question: null,
        priority: 1,
      }),
      // Points at a question in another version entirely. The payload
      // cannot contain it, so the map has to invent a placeholder or the
      // arrow vanishes along with the evidence.
      edge({
        id: E_Q4_TO_MISSING,
        from_question: Q4_UNREACHABLE,
        to_question: FOREIGN_QUESTION,
        priority: 0,
      }),
    ],
    diagnostics: {
      entry_question_id: Q1,
      decision_point_question_ids: [Q1],
      terminal_question_ids: [Q1],
      unreachable_question_ids: [Q4_UNREACHABLE],
      uncovered_option_question_ids: [],
      back_edge_ids: [],
      dead_edge_ids: [E_Q2_DEAD],
      broken_edge_ids: [E_Q2_TO_ARCHIVED, E_Q4_TO_MISSING],
    },
  };
  return { ...graph, ...overrides };
}
