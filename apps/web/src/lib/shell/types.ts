/** The app shell's data, loaded once per instance page by the instance layout. */

export interface Permission {
	allowed: boolean;
	reason: string;
}

/** A process as the sidebar and the palette list it. */
export interface ShellProcess {
	id: string;
	slug: string;
	namespace: string;
	title: string;
	status: 'published' | 'draft';
	/** Published, with draft changes not yet published. */
	draftPending: boolean;
	canEdit: Permission;
}

/** A workspace (namespace) a process can be created or imported into. */
export interface ShellSpace {
	id: string;
	namespace: string;
	label: string;
	canCreate: Permission;
}

/** A spreadsheet import the user can carry on with. */
export interface ShellImport {
	id: string;
	fileName: string;
	updatedAt: string;
	processes: number;
	namespace: string;
}

export interface ShellData {
	processes: ShellProcess[];
	spaces: ShellSpace[];
	imports: ShellImport[];
	/** Whether there is a published process here the user may start a case of. */
	canStart: Permission;
}

/** What the palette fetches when it opens: the user's cases and open tasks. */
export interface SearchData {
	cases: { id: string; title: string; subject?: string; forYou: number }[];
	tasks: {
		caseId: string;
		caseTitle: string;
		attachmentId: string;
		item: string;
		title: string;
		process: string;
		definitionSlug: string;
	}[];
}
