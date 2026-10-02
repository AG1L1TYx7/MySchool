/**
 * The H5P libraries the player serves (downloaded from the H5P hub by apps/web/scripts/h5p-setup.mjs).
 * Versions are pinned here and seeded into H5PLibraries so content always names a library we can run.
 */
export interface LibraryDefinition {
  machineName: string;
  major: number;
  minor: number;
  patch: number;
  title: string;
  runnable: boolean;
  dependencies: string[];
}

const lib = (
  machineName: string,
  version: string,
  title: string,
  runnable: boolean,
  dependencies: string[] = [],
): LibraryDefinition => {
  const [major, minor, patch] = version.split('.').map(Number);
  return { machineName, major, minor, patch, title, runnable, dependencies };
};

export const H5P_LIBRARIES: readonly LibraryDefinition[] = [
  lib('FontAwesome', '4.5.4', 'Font Awesome', false),
  lib('H5P.AdvancedText', '1.1.14', 'Text', false),
  lib('H5P.Audio', '1.5.12', 'Audio', true, ['FontAwesome']),
  lib('H5P.Blanks', '1.14.13', 'Fill in the Blanks', true, [
    'FontAwesome',
    'H5P.Question',
    'H5P.JoubelUI',
    'H5P.TextUtilities',
  ]),
  lib('H5P.Dialogcards', '1.9.18', 'Dialog Cards', true, [
    'FontAwesome',
    'H5P.JoubelUI',
    'H5P.Audio',
  ]),
  lib('H5P.DragNBar', '1.5.22', 'Drag N Bar', false, [
    'H5P.DragNDrop',
    'H5P.DragNResize',
    'H5P.FontIcons',
  ]),
  lib('H5P.DragNDrop', '1.1.5', 'Drag N Drop', false),
  lib('H5P.DragNResize', '1.2.6', "Drag'N Resize", false),
  lib('H5P.DragQuestion', '1.14.22', 'Drag and Drop', true, [
    'FontAwesome',
    'jQuery.ui',
    'H5P.JoubelUI',
    'H5P.Question',
  ]),
  lib('H5P.DragText', '1.10.17', 'Drag the Words', true, [
    'FontAwesome',
    'jQuery.ui',
    'H5P.JoubelUI',
    'H5P.Question',
  ]),
  lib('H5P.FontIcons', '1.0.6', 'H5P.FontIcons', false),
  lib('H5P.Image', '1.1.22', 'Image', false),
  lib('H5P.JoubelUI', '1.3.19', 'Joubel UI', false, [
    'FontAwesome',
    'H5P.Transition',
    'H5P.FontIcons',
  ]),
  lib('H5P.MarkTheWords', '1.11.9', 'Mark the Words', true, [
    'FontAwesome',
    'H5P.JoubelUI',
    'H5P.Question',
  ]),
  lib('H5P.MultiChoice', '1.16.14', 'Multiple Choice', true, [
    'FontAwesome',
    'H5P.JoubelUI',
    'H5P.Question',
  ]),
  lib('H5P.Question', '1.5.15', 'Question', false, [
    'FontAwesome',
    'H5P.JoubelUI',
  ]),
  lib('H5P.QuestionSet', '1.20.31', 'Question Set', true, [
    'FontAwesome',
    'H5P.Video',
    'H5P.JoubelUI',
  ]),
  lib('H5P.TextUtilities', '1.3.0', 'Text Utilities', false),
  lib('H5P.Transition', '1.0.4', 'Transition', false),
  lib('H5P.TrueFalse', '1.8.11', 'True/False Question', true, [
    'FontAwesome',
    'H5P.Question',
    'H5P.JoubelUI',
    'H5P.FontIcons',
  ]),
  lib('H5P.Video', '1.6.66', 'Video', false),
  lib('jQuery.ui', '1.10.22', 'UI', false),
];

/** Sub-content libraries a Question Set may embed; listed in its manifest so the player preloads them. */
export const QUESTION_SET_CHILDREN = [
  'H5P.MultiChoice',
  'H5P.TrueFalse',
  'H5P.Blanks',
  'H5P.Image',
  'H5P.AdvancedText',
];

/** Content types teachers can create or generate, with the library version the AI service emits. */
export const CONTENT_TYPES: Record<string, { library: string; title: string }> =
  {
    quiz: { library: 'H5P.QuestionSet 1.20', title: 'Quiz (Question Set)' },
    flashcards: {
      library: 'H5P.Dialogcards 1.9',
      title: 'Flashcards (Dialog Cards)',
    },
    multiple_choice: {
      library: 'H5P.MultiChoice 1.16',
      title: 'Multiple choice question',
    },
    true_false: { library: 'H5P.TrueFalse 1.8', title: 'True or false' },
    fill_blanks: { library: 'H5P.Blanks 1.14', title: 'Fill in the blanks' },
  };

export function findLibrary(
  machineName: string,
): LibraryDefinition | undefined {
  return H5P_LIBRARIES.find((l) => l.machineName === machineName);
}
