/**
 * A synthetic household newborn tracker (ADR 0014: made-up content only), built in memory as real
 * .xlsx bytes so the wizard can be tried in one click without committing a spreadsheet. It is
 * shaped like the trackers the wizard is for: a checklist sheet per piece of work, a title row
 * over a header row, dates, a merged title, and a shared sheet of documents.
 */
import * as XLSX from 'xlsx';

export const SAMPLE_FILE_NAME = 'newborn-tracker.xlsx';

type Row = (string | number | null)[];

const STEPS: Row = ['Step', 'Who', 'When', 'Needs', 'Records', 'Notes'];

const SHEETS: { name: string; title: string; header: Row; rows: Row[]; dates?: number }[] = [
	{
		name: 'Birth reg',
		title: 'Birth registration',
		header: [...STEPS, 'Target date'],
		dates: 6,
		rows: [
			[
				'Gather the family document set',
				'Parent',
				'Before the birth',
				'Marriage certificate; Parents’ passports',
				'Home address',
				'Originals plus 2 photocopies of each',
				46_050
			],
			[
				'Record the birth details',
				'Hospital',
				'At the birth',
				null,
				'Date and time of birth; Birth weight (kg); Place of birth; Attending doctor',
				'The hospital fills these in, not us',
				46_080
			],
			[
				'Complete the birth notification form',
				'Parent',
				'Within 7 days',
				'Date and time of birth',
				'Child’s full name; Child’s race; Child’s religion; Birth notification form',
				'Race and religion can be decided after the birth',
				46_087
			],
			[
				'Register the birth',
				'Parent',
				'Within 42 days of the birth',
				'Birth notification form; Marriage certificate; Parents’ passports',
				'Birth certificate',
				'A registry officer approves the registration',
				46_122
			],
			[
				'Get a passport photo taken',
				'Parent',
				'After registration',
				null,
				'Passport photo',
				'White background, 35 x 45 mm',
				46_130
			]
		]
	},
	{
		name: 'Passport & ID',
		title: 'Child passport and ID',
		header: STEPS,
		rows: [
			[
				'Apply for the child’s ID card',
				'Parent',
				'After the birth certificate',
				'Birth certificate',
				'Child ID number',
				null
			],
			[
				'Apply for the child’s passport',
				'Parent',
				'After the ID card',
				'Child ID number; Passport photo; Parents’ passports',
				'Child passport number',
				'Both parents sign the consent section'
			]
		]
	},
	{
		name: 'Citizenship',
		title: 'Spouse citizenship',
		header: STEPS,
		rows: [
			[
				'Submit the citizenship application',
				'Spouse',
				'When ready',
				'Marriage certificate; Spouse passport',
				'Application reference',
				null
			],
			[
				'Receive the approval letter',
				'Immigration office',
				'4 to 6 months later',
				'Application reference',
				'Approval letter; Approval expiry date',
				null
			],
			[
				'Complete the e-journey',
				'Spouse',
				'Before the approval expires',
				'Approval letter',
				'E-journey confirmation',
				'Only possible while the approval is valid'
			],
			[
				'Renounce the previous citizenship',
				'Spouse',
				'Within 30 days',
				'E-journey confirmation',
				'Renunciation certificate',
				null
			],
			[
				'Collect the citizenship certificate',
				'Spouse',
				'After renunciation',
				'Renunciation certificate',
				'Citizenship certificate',
				'An officer approves it at the counter'
			]
		]
	},
	{
		name: 'Claims',
		title: 'Medical claims',
		header: STEPS,
		rows: [
			[
				'Add the baby to the health policy',
				'Parent',
				'Within 30 days of the birth',
				'Birth certificate',
				'Policy member number',
				null
			],
			[
				'Record each invoice',
				'Parent',
				'For every bill',
				null,
				'Invoice amount; Invoice date; Invoice (PDF)',
				null
			],
			[
				'Choose the claim route',
				'Parent',
				'For every invoice',
				'Invoice amount',
				'Claim route (insurer or savings scheme)',
				'Insurer for hospital bills, savings scheme for the rest'
			],
			[
				'Submit the claim to the insurer',
				'Parent',
				'If the route is insurer',
				'Invoice (PDF); Policy member number',
				'Claim reference',
				null
			],
			[
				'Submit the claim to the savings scheme',
				'Parent',
				'If the route is savings scheme',
				'Invoice (PDF); Child ID number',
				'Claim reference',
				null
			],
			[
				'Check the claim status',
				'Parent',
				'Every week until paid or rejected',
				'Claim reference',
				'Claim status',
				null
			]
		]
	},
	{
		name: 'Documents',
		title: 'Documents we keep handing over',
		header: ['Document', 'Format', 'Copies', 'Used for'],
		rows: [
			[
				'Marriage certificate',
				'Original plus photocopy',
				2,
				'Birth registration; Spouse citizenship'
			],
			['Parents’ passports', 'Photocopy of the photo page', 1, 'Birth registration; Passport'],
			['Spouse passport', 'Digital scan (PDF)', 1, 'Spouse citizenship'],
			['Proof of home address', 'Utility bill', 1, 'Birth registration']
		]
	}
];

/** The sample tracker as .xlsx bytes. */
export function sampleWorkbook(): Uint8Array {
	const book = XLSX.utils.book_new();
	for (const sheet of SHEETS) {
		const ws = XLSX.utils.aoa_to_sheet([[sheet.title], sheet.header, ...sheet.rows]);
		ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: sheet.header.length - 1 } }];
		if (sheet.dates !== undefined) {
			const col = XLSX.utils.encode_col(sheet.dates);
			sheet.rows.forEach((_, i) => {
				const cell = ws[`${col}${i + 3}`] as XLSX.CellObject | undefined;
				if (cell) cell.z = 'yyyy-mm-dd';
			});
		}
		XLSX.utils.book_append_sheet(book, ws, sheet.name);
	}
	return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
