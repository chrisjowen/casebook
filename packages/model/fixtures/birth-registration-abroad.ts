import type { DefinitionDocument } from '../src/index.js';

/**
 * Synthetic newborn-style process: registering a birth abroad with the parents' consulate,
 * as a household spreadsheet tracker might describe it. All names and numbers are made up
 * (ADR 0014).
 */
export const birthRegistrationAbroad: DefinitionDocument = {
	schemaVersion: 1,
	namespace: 'personal/example-user/family',
	slug: 'birth-registration-abroad',
	version: 3,
	nodes: [
		{
			core: {
				id: 'process.birth-registration-abroad',
				kind: 'process',
				title: 'Register a birth abroad',
				source: { doc: 'newborn-tracker.xlsx', ref: 'Registration!A1', inferred: false }
			},
			content: 'Register the birth locally, then with the consulate so the child gets a passport.'
		},

		{ core: { id: 'stage.local-registration', kind: 'stage', title: 'Local registration' } },
		{ core: { id: 'stage.prepare-application', kind: 'stage', title: 'Prepare the application' } },
		{ core: { id: 'stage.consular-registration', kind: 'stage', title: 'Consular registration' } },

		{ core: { id: 'role.parent', kind: 'role', title: 'Parent', scope: 'case' } },
		{
			core: { id: 'role.translator', kind: 'role', title: 'Sworn translator', scope: 'namespace' }
		},
		{
			core: {
				id: 'role.consular-officer',
				kind: 'role',
				title: 'Consular officer',
				scope: 'namespace'
			}
		},

		{
			core: {
				id: 'fact.child-name',
				kind: 'fact',
				title: 'Child’s full name',
				schema: {
					type: 'string',
					minLength: 1,
					examples: ['Mira Example'],
					'x-sensitivity': 'personal'
				},
				source: { doc: 'newborn-tracker.xlsx', ref: 'Registration!B2', inferred: false }
			}
		},
		{
			core: {
				id: 'fact.date-of-birth',
				kind: 'fact',
				title: 'Date of birth',
				schema: {
					type: 'string',
					format: 'date',
					examples: ['2026-01-15'],
					'x-sensitivity': 'personal'
				},
				source: { doc: 'newborn-tracker.xlsx', ref: 'Registration!B3', inferred: false }
			}
		},
		{
			core: {
				id: 'fact.country-of-birth',
				kind: 'fact',
				title: 'Country of birth',
				schema: {
					type: 'string',
					'x-lookup': { kind: 'dataset', dataset: 'iso-3166-countries' },
					'x-sensitivity': 'personal'
				}
			}
		},
		{
			core: {
				id: 'fact.parent-passport-numbers',
				kind: 'fact',
				title: 'Parents’ passport numbers',
				schema: {
					type: 'array',
					minItems: 1,
					maxItems: 2,
					items: { type: 'string', pattern: '^[A-Z0-9]{8,9}$' },
					examples: [['X0000001', 'X0000002']],
					'x-sensitivity': 'sensitive',
					'x-evidence': {
						description: 'Photocopy of each parent’s passport photo page',
						formats: ['scan', 'photocopy'],
						copies: 1
					}
				}
			}
		},
		{
			core: {
				id: 'fact.local-birth-certificate',
				kind: 'fact',
				title: 'Local birth certificate',
				schema: {
					type: 'string',
					description: 'Certificate number as printed on the document',
					examples: ['BC-2026-000123'],
					'x-sensitivity': 'sensitive',
					'x-evidence': {
						description: 'Local birth certificate',
						formats: ['original', 'certified-copy'],
						copies: 2
					}
				},
				source: { doc: 'newborn-tracker.xlsx', ref: 'Documents!C2', inferred: false }
			}
		},
		{
			core: {
				id: 'fact.translation-required',
				kind: 'fact',
				title: 'Translation required',
				schema: { type: 'boolean' }
			}
		},
		{
			core: {
				id: 'fact.certified-translation',
				kind: 'fact',
				title: 'Certified translation of the birth certificate',
				schema: {
					type: 'string',
					format: 'uri',
					'x-evidence': {
						description: 'Sworn translation of the local birth certificate',
						formats: ['certified-translation'],
						copies: 1
					}
				}
			}
		},
		{
			core: {
				id: 'fact.application-form',
				kind: 'fact',
				title: 'Completed application form',
				schema: {
					type: 'string',
					format: 'uri',
					'x-evidence': { description: 'Signed application form', formats: ['pdf'], copies: 1 }
				}
			}
		},
		{
			core: {
				id: 'fact.appointment-at',
				kind: 'fact',
				title: 'Consular appointment',
				schema: { type: 'string', format: 'date-time' },
				source: { doc: 'newborn-tracker.xlsx', ref: 'Registration!B9', inferred: false }
			}
		},
		{
			core: {
				id: 'fact.consular-reference',
				kind: 'fact',
				title: 'Consular registration reference',
				schema: { type: 'string', pattern: '^CR-[0-9]{6}$', examples: ['CR-000042'] }
			}
		},

		{
			core: {
				id: 'step.register-locally',
				kind: 'step',
				title: 'Register the birth locally',
				stage: 'stage.local-registration',
				role: 'role.parent',
				actor: 'human',
				collects: [
					{ fact: 'fact.child-name' },
					{ fact: 'fact.date-of-birth' },
					{ fact: 'fact.country-of-birth' },
					{ fact: 'fact.local-birth-certificate' }
				],
				evidence: [
					{
						description: 'Hospital birth notification',
						formats: ['original'],
						copies: 1
					}
				],
				source: { doc: 'newborn-tracker.xlsx', ref: 'Registration!A2:B4', inferred: false }
			},
			content: 'Take the hospital notification to the local civil registry within 14 days.',
			data: { 'excel.sheet': 'Registration' }
		},
		{
			core: {
				id: 'decision.translation-required',
				kind: 'decision',
				title: 'Decide whether a translation is needed',
				stage: 'stage.prepare-application',
				role: 'role.parent',
				actor: 'either',
				requires: ['fact.country-of-birth'],
				outcome: 'fact.translation-required',
				source: { doc: 'newborn-tracker.xlsx', ref: 'Documents!D2', inferred: true }
			}
		},
		{
			core: {
				id: 'step.translate-certificate',
				kind: 'step',
				title: 'Get a certified translation',
				stage: 'stage.prepare-application',
				role: 'role.translator',
				actor: 'human',
				requires: ['fact.local-birth-certificate', 'fact.translation-required'],
				collects: [{ fact: 'fact.certified-translation' }],
				when: {
					text: 'Only if the certificate is not in an official language of the consulate',
					expr: 'fact.translation-required == true'
				}
			}
		},
		{
			core: {
				id: 'step.complete-application',
				kind: 'step',
				title: 'Complete the application form',
				stage: 'stage.prepare-application',
				role: 'role.parent',
				actor: 'either',
				requires: ['fact.child-name', 'fact.date-of-birth', 'fact.country-of-birth'],
				collects: [{ fact: 'fact.parent-passport-numbers' }, { fact: 'fact.application-form' }]
			},
			content: 'An agent may pre-fill the form from recorded facts; a parent signs it.'
		},
		{
			core: {
				id: 'step.book-appointment',
				kind: 'step',
				title: 'Book a consular appointment',
				stage: 'stage.consular-registration',
				role: 'role.parent',
				actor: 'either',
				requires: ['fact.application-form'],
				collects: [{ fact: 'fact.appointment-at' }]
			}
		},
		{
			core: {
				id: 'step.attend-appointment',
				kind: 'step',
				title: 'Attend the appointment',
				stage: 'stage.consular-registration',
				role: 'role.parent',
				actor: 'human',
				requires: [
					'fact.appointment-at',
					'fact.application-form',
					'fact.local-birth-certificate',
					'fact.parent-passport-numbers'
				],
				collects: [{ fact: 'fact.consular-reference', by: 'role.consular-officer' }],
				evidence: [
					{
						description: 'Both parents’ passports, shown in person',
						formats: ['original'],
						fact: 'fact.parent-passport-numbers'
					}
				],
				approval: 'approval.consular-review'
			}
		},
		{
			core: {
				id: 'approval.consular-review',
				kind: 'approval',
				title: 'Consular review',
				role: 'role.consular-officer',
				actor: 'human',
				requires: ['fact.application-form', 'fact.local-birth-certificate']
			}
		}
	]
};
