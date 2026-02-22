/**
 * Author: BrainZag
 * Repository: https://github.com/rqp314/BrainZag
 * License: See LICENSE file
 * Copyright (c) 2026 BrainZag
 *
 * Generates the insight message that is shown at the end of the round
 *
*/

// ------------------ Positive Insights Generator ------------------

const motivation = [
    `You don't quit when it hurts.`,
    `Your brain is adapting`,
    `Suffering is the real teacher`,
    `Perseverance equals success`,
    `Success is effort sustained over a long period of time`,
    `Your competition is your distractions`,
    `Failure -> Failure -> Failure -> Success!`,
    `This is the part where most people quit`,
    `You're in the arena. That's all that matters`,
    `Pain is just weakness leaving your brain`,
    `Nobody said this was supposed to be easy`,
    `Embrace it. That's where growth lives`,
    `Mental toughness is a muscle. You just trained it`,
    `Staring at squares is better than doomscrolling`,
    `Consistency beats talent`,
    `Keep suffering!`,
    `Cognitive chaos detected`,
    `The colors don't care about your plans`,
    `Tough rounds build the most strength`,
    `Every rep trains your brain`,
    `Struggling means you're growing`,
    `You stayed. That takes grit`,
    `Challenge accepted and faced`,
    `This is where real growth happens`,
    `Hard rounds are the most valuable`,
    `Your brain is rewiring RIGHT NOW`,
    `The score doesn't show the neural growth`,
    `Bad rounds are just warmups`,
    `But you're still here`,
    `The colors won this round. Rematch?`,
    `If this were easy, everyone would do it`,
    `Your brain just filed a complaint`,
    `The squares are laughing. Can you hear them?`,
    `You're voluntarily doing this. Wild`,
    `Your phone is proud. Probably...`,
    `Blink twice if you need help`,
    `What stands in the way becomes the way`,
    `Fall seven times, stand up eight !`,
    `Difficulty is what wakes up the genius`,
    `A smooth sea never made a skilled sailor`,
];

const midMessages = [
    `Progress isn't always linear`,
    `You're pushing your limits`,
    `Keep at it. Momentum is building`,
    `Working memory grows through challenge`,
    `Your brain is doing more than you think`,
    `Not perfect. Not quitting. That's the formula`,
    `The gap between 60% and 80% is where pros are made`,
    `Consistency over perfection. Always`,
];

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const otherMessages = [
    `This message was randomly selected`,
    `You're staring at colored squares on purpose`,
    `Your phone has 27 other apps. You chose this one`,
    `Somewhere, a neuroscientist is proud of you`,
    `You could be scrolling social media. But here you are`,
    `This game knows your accuracy. It still likes you`,
    `10 to 20 min daily is the sweet spot for gains`,
    `Train 4 to 5 days per week for best results`,
    `Short daily sessions beat long weekly ones`,
    `Your working memory peaks after 15 to 20 sessions`,
    `Consistency matters more than session length`,
    `Even 5 minutes today is better than zero`,
    `The first few sessions are always the hardest`,
    `Most improvement happens in weeks 2 to 4`,
    `We are what we repeatedly do. Excellence is a habit`,
    `The mind is not a vessel to fill but a FIRE to unleash`,
    `Discipline equals freedom`,
    `The best time to start was yesterday. Second best is NOW`,
    `What we achieve inwardly will change outer reality`,
    `Knowing yourself is the beginning of all wisdom`,
    `The only way out is through`,
    `Small daily improvements are the key to big results`,
    `99% of people will never train their working memory`,
    `You're doing what most people won't`,
    `While others scroll, you sharpen`,
    `Most brains go untrained. Yours doesn't`,
    `Right now someone is watching TV. You chose growth`,
    `You're in the 1% who actually train their brain`,
    `Nobody will do this for you. And nobody else is doing it`,
    `Your future self will thank your present self`,
    `Average is a choice. You're choosing different`,
    `Nice focus`,
    `Good awareness`,
    `Staying sharp`,
    `Brain engaged`,
    `Your attention showed up today`,
    `Locked in`,
    `You trained today. Most people didn't`,
    `Showing up is half the battle`,
    `Every session counts`,
    `Your brain thanks you`,
    `The hardest part is starting. You did that`,
    `One more session in the bank`,
    `Done is better than perfect`,
    `That's another deposit in the brain bank`,
    `N-Back is not hard, sitting down every day is`,
    `If you want to move a mountain, start with the small stones`,
];

// Count how many consecutive days (including today) the player has played
function getConsecutiveDaysStreak() {
    const today = new Date();
    let streak = 0;
    for (let i = 0; i < 365; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = formatDateLocal(d);
        if (performanceHistory.has(dateStr)) {
            streak++;
        } else {
            break;
        }
    }
    return streak;
}

// Catalog of possible insights with priority weights
function generatePositiveInsight(accuracy, roundsPlayed) {
    const insights = [];

    // 1. Longest streak
    if (longestStreak === 5 || longestStreak === 12 || longestStreak === 16 || longestStreak === 21 || longestStreak === 35) {
        insights.push({
            text: `${longestStreak} correct in a row!`,
            priority: 10
        });
    }

    // 3. Better accuracy than last round
    if (lastRoundAccuracy !== null && accuracy > lastRoundAccuracy) {
        const improvement = accuracy - lastRoundAccuracy;
        insights.push({
            text: `+${improvement}% better than last round`,
            priority: improvement >= 10 ? 9 : 6
        });
    }

    // 4. Perfect or near-perfect accuracy
    if (accuracy === 100 && roundsPlayed >= 10) {
        insights.push({
            text: `Perfect round!`,
            priority: 12
        });
    } else if (accuracy >= 90 && roundsPlayed >= 10) {
        insights.push({
            text: `Excellent accuracy!`,
            priority: 8
        });
    }

    // 5. Completed full round (40 trials)
    if (roundsPlayed == 40) {
        insights.push({
            text: `Full 40 rounds completed`,
            priority: 6
        });
    }

    // 6. Good number of rounds played
    if (roundsPlayed >= 20 && roundsPlayed < 40) {
        insights.push({
            text: `Solid session: >= 20 rounds`,
            priority: 3
        });
    }

    // 7. Daily playtime milestones
    const totalMinutes = Math.floor(elapsedSeconds / 60);
    if (totalMinutes >= 20) {
        insights.push({
            text: `Daily goal reached: 20 min`,
            priority: 7
        });
    } else if (totalMinutes >= 8 && totalMinutes < 12) {
        insights.push({
            text: `Halfway to daily time goal`,
            priority: 4
        });
    } else if (totalMinutes >= 2 && totalMinutes < 6) {
        insights.push({
            text: `Good start: over 2 min today`,
            priority: 2
        });
    }

    // 8. Zero or near zero false alarms (discipline)
    if (incorrectMatches === 0 && roundsPlayed >= 10) {
        insights.push({
            text: `Zero false alarms. Laser focus`,
            priority: 7
        });
    } else if (incorrectMatches <= 2 && roundsPlayed >= 15) {
        insights.push({
            text: `Almost no false alarms`,
            priority: 4
        });
    }

    // 9. Fast average reaction time
    if (reactionTimer.currentAvg < 350 && correctMatches >= 3) {
        insights.push({
            text: `Lightning reflexes: ~350 ms avg.`,
            priority: 7
        });
    } else if (reactionTimer.currentAvg < 500 && correctMatches >= 3) {
        insights.push({
            text: `Quick reactions: ~500 ms avg.`,
            priority: 4
        });
    }

    // 10. Training at a high N level
    if (n >= 5) {
        insights.push({
            text: `${n}-back: PRO level`,
            priority: 7
        });
    } else if (n >= 4) {
        insights.push({
            text: `${n}-back: elite territory`,
            priority: 7
        });
    } else if (n >= 3) {
        insights.push({
            text: `${n}-back is no joke. Well done`,
            priority: 5
        });
    }

    // 11. Consecutive days played
    const dayStreak = getConsecutiveDaysStreak();
    if (dayStreak >= 7) {
        insights.push({
            text: `Played ${dayStreak} days in a row! Unstoppable`,
            priority: 11
        });
    } else if (dayStreak >= 3) {
        insights.push({
            text: `${dayStreak} days in a row. Building a habit`,
            priority: 8
        });
    } else if (dayStreak >= 2) {
        insights.push({
            text: `Back again today. Consistency wins`,
            priority: 5
        });
    }

    // 12. Good correct rejection rate (knew when NOT to click)
    const nonMatches = roundsPlayed - totalTargets;
    const correctRejections = nonMatches - incorrectMatches;
    if (nonMatches >= 5 && correctRejections / nonMatches >= 0.95) {
        insights.push({
            text: `Great restraint: knew when to hold back`,
            priority: 5
        });
    }

    // 13. Handled near max memory load
    const roundTrials = getCurrentRoundTrials();
    if (roundTrials.length >= 5) {
        const peakLoad = Math.max(...roundTrials.map(t => t.currentLoad));
        const maxPossible = n + 1;
        if (peakLoad >= maxPossible * 0.8) {
            insights.push({
                text: `Handled near-max memory load`,
                priority: 6
            });
        }
    }

    // 14. Cumulative daily milestones from pendingPerformance
    if (pendingPerformance) {
        const totalDecisions = pendingPerformance.hits + pendingPerformance.misses
            + pendingPerformance.falseAlarms + pendingPerformance.correctRejections;
        if (totalDecisions >= 200) {
            insights.push({
                text: `Over 200 decisions made today`,
                priority: 5
            });
        } else if (totalDecisions >= 100) {
            insights.push({
                text: `Over 100 decisions made today`,
                priority: 3
            });
        }

        if (pendingPerformance.hits >= 30) {
            insights.push({
                text: `Over 30 matches caught today`,
                priority: 4
            });
        }
    }

    // 15. Unlocked a higher level than currently playing
    if (highestUnlockedLevel > n) {
        insights.push({
            text: `Level ${highestUnlockedLevel}-back unlocked. Ready when you are`,
            priority: 6
        });
    }

    // 16. Bounced back from a bad round
    if (lastRoundAccuracy !== null && lastRoundAccuracy < 50 && accuracy >= 60) {
        insights.push({
            text: `Great comeback from last round`,
            priority: 9
        });
    }

    // 17. Encouragement for tough rounds (low accuracy)
    if (accuracy < 50 && roundsPlayed >= 6) {
        insights.push({
            text: motivation[Math.floor(Math.random() * motivation.length)],
            priority: 6
        });

    } else if (accuracy >= 50 && accuracy < 70 && roundsPlayed >= 6) {
        insights.push({
            text: midMessages[Math.floor(Math.random() * midMessages.length)],
            priority: 3
        });
    }

    // 24. Time and day aware messages
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0=Sun, 1=Mon ... 6=Sat
    const isWeekend = day === 0 || day === 6;
    const timeMessages = [];

    // Late night (22:00 to 2:59)
    if (hour >= 22 || hour < 3) {
        timeMessages.push(
            `Late night brain training. Dedicated`,
            `${dayNames[day]} night grind. Respect`,
            `Most people are asleep right now. You're leveling up`,
        );
    }
    // Early morning (4:00 to 7:59)
    else if (hour >= 4 && hour < 8) {
        timeMessages.push(
            `Early bird gets the neural gains`,
            `${dayNames[day]} morning, brain already warming up`,
            `Up before the alarm and already training`,
            `Dawn session. That's elite behavior`,
        );
    }
    // Morning (8:00 to 11:59)
    else if (hour >= 8 && hour < 12) {
        timeMessages.push(
            `Morning session. Sharp start to ${dayNames[day]}`,
            `Getting it done before lunch. Smart`,
        );
    }
    // Afternoon (12:00 to 16:59)
    else if (hour >= 12 && hour < 17) {
        timeMessages.push(
            `${dayNames[day]} afternoon brain boost`,
            `Beating the afternoon slump with training`,
        );
    }
    // Evening (17:00 to 21:59)
    else if (hour >= 17 && hour < 22) {
        timeMessages.push(
            `${dayNames[day]} evening well spent`,
            `Winding down the day with brain gains`,
            `Evening session locked in`,
        );
    }

    // Day specific additions
    if (day === 1) { // Monday
        timeMessages.push(
            `Monday training. Strong start to the week`,
            `Most people dread Mondays. You use them`,
        );
    } else if (day === 5) { // Friday
        timeMessages.push(
            `Friday and you're training? That's commitment`,
            `TGIF? More like: Thank God I TRAINED`,
        );
        if (hour >= 17) {
            timeMessages.push(`Friday night brain training. Legend`);
        }
    } else if (isWeekend) {
        timeMessages.push(
            `Weekend warrior. Training when others rest`,
            `${dayNames[day]} session. No days off for your brain`,
            `Working out your brain on the weekend. Nice`,
        );
    }

    let selected = ``

    // Try the top 3 priority insights, pick the first one not recently shown
    if (insights.length > 0) {
        insights.sort((a, b) => b.priority - a.priority);
        for (let i = 0; i < Math.min(3, insights.length); i++) {
            if (!recentInsights.includes(insights[i].text)) {
                selected = insights[i].text;
                break;
            }
        }
    }

    // No insight selected, fall back to generic messages
    if (selected === ``) {
        // 20% chance of showing nothing when nothing special happened
        if (Math.random() < 0.2) return ``;

        // Pool one random time message and one random other message
        const generic_message = []
        if (timeMessages.length > 0) {
            generic_message.push(timeMessages[Math.floor(Math.random() * timeMessages.length)]);
        }
        generic_message.push(otherMessages[Math.floor(Math.random() * otherMessages.length)]);

        // Pick one at random from the pool
        const randomIndex = Math.floor(Math.random() * generic_message.length);

        // Backup in case the pick was recently shown
        const backup_message = otherMessages[Math.floor(Math.random() * otherMessages.length)]

        selected = !recentInsights.includes(generic_message[randomIndex]) ? generic_message[randomIndex] : !recentInsights.includes(backup_message) ? backup_message : ``;
    }

    // Track recently shown messages to avoid repetition (rolling window of 15)
    if (selected !== ``) recentInsights.push(selected);
    if (recentInsights.length > 15) recentInsights.shift();
    return selected;
}
