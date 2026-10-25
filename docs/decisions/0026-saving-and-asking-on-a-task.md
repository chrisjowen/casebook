# 0026. Saving a task for later and asking for information on it

Status: Accepted. Amends 0022.

## Context
Trying the runner end to end showed the journey of starting a case and filling in its tasks was hard to follow: a long start form, a task page that mixed context and form, no way to keep half-filled work, and a dead end after finishing a task.
Pausing a task (0022) only left a note; there was no way to ask a named person for the missing information and get the answer back on the task.

## Decision
- **Starting a case is a guided flow** of three steps on one form: what to run, which case it is for and who's who, then a check of what happens next. Starting it goes straight to the first task when that task is the starter's and ready, otherwise to the case.
- **A task is one focused page**: its stage strip and status, its form with one action bar (Complete, Save for later, I can't finish this yet), its questions, and a rail listing the process's other work by stage. After completing it the page hands over to the user's next ready task, on the same case first.
- **Saving** records `step.saved` with the form's typed values: as people type (after a short pause, and when they leave the page), and on Save for later. It records no facts, so nothing on the case or in other processes changes; everyone who can do the task sees the saved values and who saved them, and completing or skipping the task clears them. Files are attached on completion only. Saving also records `step.started` once.
- **Questions** are threads on a work item: `question.asked` names the person asked, who must be able to open the case; `question.replied` adds an answer or follow-up; `question.resolved` closes it. The person asked, the asker and anyone who can do the task reply and resolve; finishing the task closes its open questions. A question waits on the person asked until their reply is the latest. Questions are asked from the same panel as pausing, "I can't finish this yet": it says what is missing and, optionally, who can help, pausing the task while they answer.
- **My work** lists the questions waiting on the user first, under Questions for you, and they count towards what waits on them; a task whose question has a new answer says so and comes first in its group, and a paused task shows the answer beside its Resume.
- These event names sit beside the reserved lifecycle names (0010) and never change a work item's status: progress is still folded from the work-item events alone.

## Consequences
- A saved form is shared by the task's role, like the facts it will record, so whoever picks the task up carries on from it.
- Only people who can open the case are asked; a guest is never asked, and a guest's form shows no questions.
- Answering does not resume a paused task: whoever does the task resumes it when they have what they need.
